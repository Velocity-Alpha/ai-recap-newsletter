/**
 * The section scoring test (#176): does OpenAI Decisions API scoring over section definitions put stories where the
 * owner put them, and does automatic fill in fill order rebuild the owner's issues?
 *
 * Reads the Neon `dev` branch only (read-only). Scores are cached by story id and by the hash of the questions in
 * `evals/data/section-scoring/` (gitignored), so a rerun with the same definitions makes no new calls.
 *
 *   DATABASE_URL=<dev> OPENAI_API_KEY=... npx vite-node --config evals/vitest.eval.config.ts evals/section-scoring/run.ts
 *
 * SECTION_SCORING_LIMIT=20 scores only the first 20 stories (a smoke test).
 */
import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { auc, fill, groupEvents, rankOf, type Scorer } from "@/evals/section-scoring/fill";
import {
  buildQuestions,
  DEVELOPER_MESSAGE,
  NONE,
  SECTIONS,
  type StoryScores,
} from "@/evals/section-scoring/sections";
import { cleanText, normalizeCategory, processAndRankStories, type StoryRecord } from "@/src/features/newsletter/curation.service";
import { DECISIONS_MODEL } from "@/src/pipeline/repeats/decisions";

const SINCE = "2026-08-01";
const CONCURRENCY = 8;
/**
 * Two stories with embeddings this similar count as one event. Of the repeat check's judged pairs on `dev` with
 * similarity 0.7 or more, the judge called 30 of 37 the same development.
 */
const SAME_EVENT_SIMILARITY = 0.7;
const OUT_DIR = path.resolve(__dirname, "../data/section-scoring");

interface StoryRow {
  id: number;
  day: string;
  headline: string | null;
  summary: string | null;
  story_details: string | null;
  category: string | null;
  importance_score: number | null;
  url: string | null;
  used: string | null;
  excluded_on: string | null;
}
interface PublishedRow {
  issue_date: string;
  story_id: number;
  section: string;
}
interface Candidate {
  id: number;
  bucket: string;
  /** Today's rank value: extraction importance plus the keyword score (`processAndRankStories`). 0 below importance 2. */
  todayScore: number;
  extractionImportance: number;
  scores: StoryScores;
}

interface Answer {
  type: string;
  name: string;
  probability?: number;
  score?: number;
  probabilities?: { value: string | number; probability: number }[];
}

const QUESTIONS = buildQuestions();
const VERSION = createHash("sha1")
  .update(JSON.stringify([DEVELOPER_MESSAGE, QUESTIONS]))
  .digest("hex")
  .slice(0, 8);
const CACHE_FILE = path.join(OUT_DIR, `scores-${VERSION}.json`);

let inputTokens = 0;

async function scoreStory(story: StoryRow, apiKey: string): Promise<StoryScores> {
  const text = [cleanText(story.headline), cleanText(story.summary), cleanText(story.story_details).slice(0, 1500)]
    .filter(Boolean)
    .join("\n");
  const body = JSON.stringify({
    model: DECISIONS_MODEL,
    input: [
      { role: "developer", content: DEVELOPER_MESSAGE },
      { role: "user", content: text },
    ],
    questions: QUESTIONS,
  });
  for (let attempt = 0; ; attempt++) {
    const response = await fetch("https://api.openai.com/v1/decisions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(30_000),
    }).catch((error: unknown) => (attempt < 3 ? null : Promise.reject(error)));
    if (response?.ok) {
      const json = (await response.json()) as { answers: Answer[]; usage?: { input_tokens?: number } };
      inputTokens += json.usage?.input_tokens ?? 0;
      return parseAnswers(json.answers);
    }
    if (attempt >= 3 || (response && response.status !== 429 && response.status < 500)) {
      throw new Error(`Decisions API: HTTP ${response?.status}: ${(await response?.text())?.slice(0, 300)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 2000 * (attempt + 1)));
  }
}

function parseAnswers(answers: Answer[]): StoryScores {
  const byName = new Map(answers.map((answer) => [answer.name, answer]));
  const section = byName.get("section");
  const importance = byName.get("importance");
  if (!section?.probabilities || typeof importance?.score !== "number" || !importance.probabilities) {
    throw new Error(`Decisions API: unexpected answers: ${JSON.stringify(answers).slice(0, 400)}`);
  }
  const fits: Record<string, number> = {};
  for (const s of SECTIONS) {
    const answer = byName.get(`fits:${s.key}`);
    if (typeof answer?.probability !== "number") throw new Error(`Decisions API: no answer for fits:${s.key}`);
    fits[s.key] = answer.probability;
  }
  return {
    choice: Object.fromEntries(section.probabilities.map((p) => [String(p.value), p.probability])),
    fits,
    importance: importance.score + 1,
    importanceLevels: importance.probabilities.map((p) => p.probability),
  };
}

async function scoreAll(stories: StoryRow[]): Promise<Map<number, StoryScores>> {
  const cache: Record<string, StoryScores> = existsSync(CACHE_FILE) ? JSON.parse(readFileSync(CACHE_FILE, "utf8")) : {};
  const todo = stories.filter((story) => !cache[story.id]);
  const apiKey = process.env.OPENAI_API_KEY;
  if (todo.length > 0 && !apiKey) throw new Error("OPENAI_API_KEY is not set.");
  console.log(`Definitions version ${VERSION}: ${stories.length - todo.length} stories cached, ${todo.length} to score.`);
  let next = 0;
  let failed = 0;
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < todo.length) {
        const story = todo[next++];
        try {
          cache[story.id] = await scoreStory(story, apiKey!);
        } catch (error) {
          failed++;
          console.error(`story ${story.id}: ${(error as Error).message}`);
          if (failed > 20) throw new Error("Too many failed calls. Stopped.");
        }
        if (next % 200 === 0) {
          writeFileSync(CACHE_FILE, JSON.stringify(cache));
          console.log(`  ${next}/${todo.length}`);
        }
      }
    }),
  );
  writeFileSync(CACHE_FILE, JSON.stringify(cache));
  if (todo.length > 0) {
    console.log(`Input tokens: ${inputTokens} (about $${((inputTokens / 1e6) * 0.1).toFixed(2)}). Failed calls: ${failed}.`);
  }
  return new Map(Object.entries(cache).map(([id, scores]) => [Number(id), scores]));
}

/** The repeat check's embedding (text-embedding-3-small, 512 numbers, headline and summary) for every story. Cached. */
async function embedAll(stories: StoryRow[]): Promise<Map<number, number[]>> {
  const file = path.join(OUT_DIR, "embeddings.json");
  const cache: Record<string, number[]> = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const todo = stories.filter((story) => !cache[story.id]);
  for (let i = 0; i < todo.length; i += 256) {
    const batch = todo.slice(i, i + 256);
    const response = await fetch("https://api.openai.com/v1/embeddings", {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "text-embedding-3-small",
        dimensions: 512,
        input: batch.map((story) => `${story.headline ?? ""}\n${story.summary ?? ""}`),
      }),
    });
    if (!response.ok) throw new Error(`Embeddings: HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    const json = (await response.json()) as { data: { index: number; embedding: number[] }[] };
    for (const item of json.data) cache[batch[item.index].id] = item.embedding.map((x) => Number(x.toFixed(5)));
  }
  if (todo.length > 0) writeFileSync(file, JSON.stringify(cache));
  return new Map(Object.entries(cache).map(([id, vector]) => [Number(id), vector]));
}

/** What a stream holds: one story, or every story in the window that reports one event. */
interface Unit {
  id: number;
  members: Candidate[];
}

/** A way to score a story for a section: how well it fits, times how important it is. */
interface Method {
  name: string;
  scorer: Scorer<Candidate>;
}

const GENERAL = new Set(["headlines", "quick_hits"]);
/** Today's rule: research and tools stories fill their own section; every other story fills Top Stories, then Quick Hits. */
const categoryFit = (c: Candidate, section: string) =>
  c.bucket === "research"
    ? Number(section === "research_and_analysis")
    : c.bucket === "tools"
      ? Number(section === "tools")
      : Number(GENERAL.has(section));

const METHODS: Method[] = [
  { name: "Today (category, extraction importance + keywords)", scorer: (c, s) => categoryFit(c, s) * c.todayScore },
  { name: "choice × importance", scorer: (c, s) => (c.scores.choice[s] ?? 0) * c.scores.importance },
  { name: "predicate × importance", scorer: (c, s) => c.scores.fits[s] * c.scores.importance },
  { name: "predicate × importance²", scorer: (c, s) => c.scores.fits[s] * c.scores.importance ** 2 },
  { name: "predicate × extraction importance", scorer: (c, s) => c.scores.fits[s] * c.extractionImportance },
  { name: "category × Decisions importance", scorer: (c, s) => categoryFit(c, s) * c.scores.importance },
];

const pct = (n: number, d: number) => (d === 0 ? "n/a" : `${Math.round((100 * n) / d)}%`);
const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted.length === 0 ? NaN : sorted[Math.floor((sorted.length - 1) / 2)];
};

async function main() {
  const published = await readOnlyQuery<PublishedRow>(
    `select to_char(i.issue_date, 'YYYY-MM-DD') issue_date, x.story_id, x.section
     from newsletter.issue_stories x join newsletter.issues i on i.id = x.issue_id
     where i.issue_date >= $1 and i.status = 'published'`,
    [SINCE],
  );
  let stories = await readOnlyQuery<StoryRow>(
    `select id, to_char(day, 'YYYY-MM-DD') "day", headline, summary, story_details, category, importance_score, url,
            to_char(used_in_publication_date, 'YYYY-MM-DD') used, to_char(excluded_on, 'YYYY-MM-DD') excluded_on
     from newsletter.stories
     where day >= $1::date - 3 and coalesce(headline, '') <> '' order by id`,
    [SINCE],
  );
  if (!published || !stories) throw new Error("DATABASE_URL is not set (use the Neon dev branch).");

  const issueDates = [...new Set(published.map((row) => row.issue_date))].sort();
  const lastDate = issueDates[issueDates.length - 1];
  stories = stories.filter((story) => story.day <= lastDate);
  const limit = Number(process.env.SECTION_SCORING_LIMIT ?? 0);
  if (limit > 0) stories = stories.slice(0, limit);

  mkdirSync(OUT_DIR, { recursive: true });
  const scores = await scoreAll(stories);

  const ranked = new Map(
    processAndRankStories(
      stories.map((s) => ({ ...s, importance_score: s.importance_score ?? 0 }) as unknown as StoryRecord),
    ).map((story) => [story.id, story.combined_score]),
  );
  const candidates = new Map<number, Candidate>();
  const rows = new Map<number, StoryRow>();
  for (const story of stories) {
    const storyScores = scores.get(story.id);
    if (!storyScores) continue;
    const extractionImportance = story.importance_score ?? 0;
    rows.set(story.id, story);
    candidates.set(story.id, {
      id: story.id,
      bucket: normalizeCategory(story.category),
      todayScore: extractionImportance >= 2 ? (ranked.get(story.id) ?? 0) : 0,
      extractionImportance,
      scores: storyScores,
    });
  }

  const daysBefore = (date: string, days: number) => {
    const d = new Date(`${date}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - days);
    return d.toISOString().slice(0, 10);
  };
  /** The board's candidate window on issue date D, rebuilt: 3 days back, not used or excluded before D. */
  const poolFor = (date: string, publishedIds: Set<number>): Candidate[] => {
    const start = daysBefore(date, 3);
    return [...candidates.values()].filter((c) => {
      if (publishedIds.has(c.id)) return true;
      const row = rows.get(c.id)!;
      return (
        row.day >= start &&
        row.day <= date &&
        (!row.used || row.used >= date) &&
        (!row.excluded_on || row.excluded_on >= date) &&
        Boolean(row.url)
      );
    });
  };

  const lines: string[] = [];
  const say = (line = "") => {
    lines.push(line);
    console.log(line);
  };
  const scoredPublished = published.filter((row) => candidates.has(row.story_id));
  say(`Section scoring test (#176). Definitions version ${VERSION}. Issues since ${SINCE}: ${issueDates.length}.`);
  say(`Published stories with scores: ${scoredPublished.length} of ${published.length}. Stories scored: ${candidates.size}.`);

  // 1. Section agreement on published stories.
  say("\n1. Does the section match the owner's section? (published stories)");
  const keys = SECTIONS.map((s) => s.key);
  const argmax = (probabilities: Record<string, number>) => keys.reduce((a, b) => (probabilities[b] > probabilities[a] ? b : a));
  const merge = (section: string) => (GENERAL.has(section) ? "general" : section);
  let choiceTop = 0;
  let choiceTop2 = 0;
  let choiceMerged = 0;
  let fitsMerged = 0;
  let todayMerged = 0;
  let fitsOwner = 0;
  let pickedNone = 0;
  const confusion: Record<string, Record<string, number>> = {};
  for (const row of scoredPublished) {
    const c = candidates.get(row.story_id)!;
    const order = [...keys].sort((a, b) => c.scores.choice[b] - c.scores.choice[a]);
    choiceTop += Number(order[0] === row.section);
    choiceTop2 += Number(order.slice(0, 2).includes(row.section));
    choiceMerged += Number(merge(order[0]) === merge(row.section));
    fitsMerged += Number(merge(argmax(c.scores.fits)) === merge(row.section));
    fitsOwner += Number(c.scores.fits[row.section] >= 0.5);
    pickedNone += Number((c.scores.choice[NONE] ?? 0) > Math.max(...keys.map((k) => c.scores.choice[k])));
    const today = c.bucket === "research" ? "research_and_analysis" : c.bucket === "tools" ? "tools" : "general";
    todayMerged += Number(today === merge(row.section));
    (confusion[row.section] ??= {})[order[0]] = (confusion[row.section][order[0]] ?? 0) + 1;
  }
  const n = scoredPublished.length;
  say(`  choice, 4 sections: top choice ${pct(choiceTop, n)}, in the top two ${pct(choiceTop2, n)}`);
  say(`  3 groups (Top Stories and Quick Hits as one): choice ${pct(choiceMerged, n)}, predicate ${pct(fitsMerged, n)}, today's category ${pct(todayMerged, n)}`);
  say(`  predicate for the owner's section is 0.5 or more: ${pct(fitsOwner, n)}. choice prefers "none": ${pct(pickedNone, n)}`);
  say("  owner's section → top choice:");
  for (const key of keys) {
    say(`    ${key}: ${keys.map((k) => `${k} ${confusion[key]?.[k] ?? 0}`).join(", ")}`);
  }

  // 2. Importance.
  say("\n2. Does importance separate what the owner published? (AUC: 0.5 is chance, 1 is perfect)");
  const publishedByDate = new Map<string, PublishedRow[]>();
  for (const row of scoredPublished) publishedByDate.set(row.issue_date, [...(publishedByDate.get(row.issue_date) ?? []), row]);
  const pools = new Map<string, Candidate[]>();
  for (const date of issueDates) {
    pools.set(date, poolFor(date, new Set((publishedByDate.get(date) ?? []).map((row) => row.story_id))));
  }
  const measures: [string, (c: Candidate) => number][] = [
    ["Decisions importance", (c) => c.scores.importance],
    ["extraction importance", (c) => c.extractionImportance],
    ["1 − choice none", (c) => 1 - (c.scores.choice[NONE] ?? 0)],
  ];
  for (const [name, value] of measures) {
    const pos: number[] = [];
    const neg: number[] = [];
    const top: number[] = [];
    const quick: number[] = [];
    for (const date of issueDates) {
      const rowsOfDate = publishedByDate.get(date) ?? [];
      const sectionOf = new Map(rowsOfDate.map((row) => [row.story_id, row.section]));
      for (const c of pools.get(date)!) {
        const section = sectionOf.get(c.id);
        (section ? pos : neg).push(value(c));
        if (section === "headlines") top.push(value(c));
        if (section === "quick_hits") quick.push(value(c));
      }
    }
    say(`  ${name}: published vs not published ${auc(pos, neg).toFixed(3)}; Top Stories vs Quick Hits ${auc(top, quick).toFixed(3)}`);
  }
  const mean = (values: number[]) => (values.reduce((a, b) => a + b, 0) / values.length).toFixed(2);
  for (const key of [...keys, "not published"]) {
    const list: Candidate[] = [];
    for (const date of issueDates) {
      const sectionOf = new Map((publishedByDate.get(date) ?? []).map((row) => [row.story_id, row.section]));
      for (const c of pools.get(date)!) if ((sectionOf.get(c.id) ?? "not published") === key) list.push(c);
    }
    say(`  mean importance, ${key}: Decisions ${mean(list.map((c) => c.scores.importance))}, extraction ${mean(list.map((c) => c.extractionImportance))}`);
  }
  const poolSizes = issueDates.map((date) => pools.get(date)!.length);
  say(`  (candidate window: median ${median(poolSizes)} stories a day)`);

  // 5. Only the stories the board showed. The board shows, by today's rank, 15 general stories (3 + 3 fill-ins + 6 + 3
  // fill-ins), 7 research stories and 6 tools stories, so the owner could pick from these only. Inside this set every
  // measure ranks the same stories, which makes the comparison fair.
  say("\n5. Among the stories the board showed the owner: does the measure put the published ones first? (AUC within a day)");
  const SHOWN: Record<string, number> = { general: 15, research: 7, tools: 6 };
  const bucketOf = (c: Candidate) => (c.bucket === "research" || c.bucket === "tools" ? c.bucket : "general");
  const fitFor = (probabilities: Record<string, number>, bucket: string) =>
    bucket === "general"
      ? Math.max(probabilities.headlines ?? 0, probabilities.quick_hits ?? 0)
      : (probabilities[bucket === "research" ? "research_and_analysis" : "tools"] ?? 0);
  const shownMeasures: [string, (c: Candidate, bucket: string) => number][] = [
    ["today's rank value", (c) => c.todayScore],
    ["extraction importance", (c) => c.extractionImportance],
    ["Decisions importance", (c) => c.scores.importance],
    ["predicate × Decisions importance", (c, b) => fitFor(c.scores.fits, b) * c.scores.importance],
    ["predicate × extraction importance", (c, b) => fitFor(c.scores.fits, b) * c.extractionImportance],
    ["predicate only", (c, b) => fitFor(c.scores.fits, b)],
    ["extraction + Decisions importance", (c) => c.extractionImportance + c.scores.importance],
  ];
  for (const [name, value] of shownMeasures) {
    const parts: string[] = [];
    for (const bucket of Object.keys(SHOWN)) {
      let wins = 0;
      let pairs = 0;
      for (const date of issueDates) {
        const publishedIds = new Set((publishedByDate.get(date) ?? []).map((row) => row.story_id));
        const shown = pools
          .get(date)!
          .filter((c) => bucketOf(c) === bucket && c.todayScore > 0)
          .sort((a, b) => b.todayScore - a.todayScore || a.id - b.id)
          .slice(0, SHOWN[bucket]);
        const pos = shown.filter((c) => publishedIds.has(c.id)).map((c) => value(c, bucket));
        const neg = shown.filter((c) => !publishedIds.has(c.id)).map((c) => value(c, bucket));
        if (pos.length === 0 || neg.length === 0) continue;
        wins += auc(pos, neg) * pos.length * neg.length;
        pairs += pos.length * neg.length;
      }
      parts.push(`${bucket} ${(wins / pairs).toFixed(3)}`);
    }
    say(`  ${name}: ${parts.join(", ")}`);
  }
  // The shown set with its labels and measures, for analysis outside this script (local only).
  const shownRows: object[] = [];
  for (const date of issueDates) {
    const sectionOf = new Map((publishedByDate.get(date) ?? []).map((row) => [row.story_id, row.section]));
    for (const bucket of Object.keys(SHOWN)) {
      pools
        .get(date)!
        .filter((c) => bucketOf(c) === bucket && c.todayScore > 0)
        .sort((a, b) => b.todayScore - a.todayScore || a.id - b.id)
        .slice(0, SHOWN[bucket])
        .forEach((c) =>
          shownRows.push({ date, id: c.id, bucket, section: sectionOf.get(c.id) ?? null, todayScore: c.todayScore, extractionImportance: c.extractionImportance, scores: c.scores }),
        );
    }
  }
  writeFileSync(path.join(OUT_DIR, `shown-${VERSION}.json`), JSON.stringify(shownRows));
  let shownPublished = 0;
  for (const date of issueDates) {
    const shownIds = new Set<number>();
    for (const bucket of Object.keys(SHOWN)) {
      pools
        .get(date)!
        .filter((c) => bucketOf(c) === bucket && c.todayScore > 0)
        .sort((a, b) => b.todayScore - a.todayScore || a.id - b.id)
        .slice(0, SHOWN[bucket])
        .forEach((c) => shownIds.add(c.id));
    }
    shownPublished += (publishedByDate.get(date) ?? []).filter((row) => shownIds.has(row.story_id)).length;
  }
  say(`  (${pct(shownPublished, n)} of published stories are in this rebuilt shown set)`);

  // 3 and 4. Automatic fill and stream rank, per method: by story, then by event.
  const fillSections = [...SECTIONS].sort((a, b) => a.fillOrder - b.fillOrder);
  const vectors = await embedAll(stories);
  const similar = (a: number, b: number) => {
    const va = vectors.get(a);
    const vb = vectors.get(b);
    if (!va || !vb) return false;
    let dot = 0;
    for (let i = 0; i < va.length; i++) dot += va[i] * vb[i];
    return dot >= SAME_EVENT_SIMILARITY;
  };
  const eventGroups = new Map(issueDates.map((date) => [date, groupEvents(pools.get(date)!.map((c) => c.id), similar)]));

  for (const level of ["story", "event"] as const) {
    say(`\n3. Automatic fill in fill order (3, 4, 3, 6), by ${level}: how many of the owner's stories does it pre-select?`);
    say(`4. Stream rank, by ${level}: where is each published story in its section's stream? (the owner's stories of other sections removed)`);
    if (level === "event") {
      const sizes = issueDates.map((date) => new Set(eventGroups.get(date)!.values()).size);
      say(`   (stories with embedding similarity ${SAME_EVENT_SIMILARITY} or more count as one event; median ${median(sizes)} events a day)`);
    }
    for (const method of METHODS) {
      const scorer: Scorer<Unit> = (unit, section) => Math.max(...unit.members.map((member) => method.scorer(member, section)));
      const hits: Record<string, number> = {};
      const totals: Record<string, number> = {};
      let anySection = 0;
      let selectedCount = 0;
      let selectedPublished = 0;
      const ranks: Record<string, (number | null)[]> = {};
      for (const date of issueDates) {
        const pool = pools.get(date)!;
        const groupOf = (id: number) => (level === "event" ? eventGroups.get(date)!.get(id)! : id);
        const units = new Map<number, Unit>();
        for (const c of pool) {
          const unit = units.get(groupOf(c.id)) ?? { id: groupOf(c.id), members: [] };
          unit.members.push(c);
          units.set(unit.id, unit);
        }
        const unitList = [...units.values()];
        const rowsOfDate = publishedByDate.get(date) ?? [];
        const result = fill(unitList, fillSections, scorer);
        const selectedAnywhere = new Set(Object.values(result).flatMap((list) => list.map((unit) => unit.id)));
        const publishedUnits = new Set(rowsOfDate.map((row) => groupOf(row.story_id)));
        selectedCount += selectedAnywhere.size;
        selectedPublished += [...selectedAnywhere].filter((id) => publishedUnits.has(id)).length;
        for (const row of rowsOfDate) {
          const unitId = groupOf(row.story_id);
          totals[row.section] = (totals[row.section] ?? 0) + 1;
          hits[row.section] = (hits[row.section] ?? 0) + Number(result[row.section].some((unit) => unit.id === unitId));
          anySection += Number(selectedAnywhere.has(unitId));
          const elsewhere = new Set(
            rowsOfDate.filter((other) => other.section !== row.section).map((other) => groupOf(other.story_id)),
          );
          elsewhere.delete(unitId);
          const streamPool = unitList.filter((unit) => !elsewhere.has(unit.id));
          (ranks[row.section] ??= []).push(rankOf(streamPool, row.section, scorer, unitId));
        }
      }
      const total = Object.values(totals).reduce((a, b) => a + b, 0);
      const hit = Object.values(hits).reduce((a, b) => a + b, 0);
      say(`\n  ${method.name}`);
      say(`    fill: right section ${hit}/${total} (${pct(hit, total)}), any section ${anySection}/${total} (${pct(anySection, total)}); ${pct(selectedPublished, selectedCount)} of pre-selected ${level === "event" ? "events" : "stories"} were published`);
      for (const key of keys) {
        const list = ranks[key] ?? [];
        const found = list.filter((rank): rank is number => rank !== null);
        const within = (k: number) => pct(found.filter((rank) => rank <= k).length, list.length);
        say(`    ${key}: fill ${hits[key] ?? 0}/${totals[key] ?? 0}; stream rank median ${median(found)}, top 5 ${within(5)}, top 10 ${within(10)}, top 20 ${within(20)}, not in stream ${pct(list.length - found.length, list.length)}`);
      }
    }
  }

  writeFileSync(path.join(OUT_DIR, `summary-${VERSION}.txt`), `${lines.join("\n")}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
