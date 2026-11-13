/**
 * Builds the labeling page of one golden-set batch (#177).
 *
 * Reads story text from the Neon `dev` branch (read-only) and the scores of the current scoring version from
 * `evals/data/section-scoring/` (gitignored; `run.ts` makes them). Fixes the check set on the first run, picks a new
 * tuning batch when asked for one, and writes both into `sets.json` (story ids only). Writes the page to
 * `evals/data/section-scoring/label-<batch>.html`.
 *
 *   DATABASE_URL=<dev> npx vite-node --config evals/vitest.eval.config.ts evals/section-scoring/build-batch.ts -- tuning-1
 *
 * The batch is "tuning-<n>" or "check". A batch already in `sets.json` is rebuilt with the same stories.
 */
import { buildSync } from "esbuild";
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { hashInput } from "@/evals/lib/golden";
import { CHECK_BATCH, type Sets } from "@/evals/section-scoring/golden-labels";
import { groupEvents } from "@/evals/section-scoring/fill";
import { hardCases, pickCheckSet, pickTuningBatch, recommend, type PoolStory } from "@/evals/section-scoring/golden-set";
import { buildPage, type PageStory } from "@/evals/section-scoring/page";
import { IMPORTANCE_LEVELS, scoringVersion, type StoryScores } from "@/evals/section-scoring/sections";
import { cleanText, normalizeCategory } from "@/src/features/newsletter/curation.service";

const DATA_DIR = path.resolve(__dirname, "../data/section-scoring");
const SETS_FILE = path.resolve(__dirname, "sets.json");
const SEED = 177;
const WEEKS = 8;
const CHECK_SIZE = 150;
const CHECK_HIDDEN = 50;
const BATCH_SIZE = 100;
/** The scoring test's rule: stories this similar report one event (run.ts, SAME_EVENT_SIMILARITY). */
const SAME_EVENT_SIMILARITY = 0.7;
/** Two stories are one event only when their days are this close. */
const SAME_EVENT_DAYS = 3;

interface StoryRow {
  id: number;
  day: string;
  headline: string | null;
  summary: string | null;
  source: string | null;
  url: string | null;
  category: string | null;
  importance_score: number | null;
}

const readJson = <T>(file: string): T => JSON.parse(readFileSync(file, "utf8")) as T;
const dayNumber = (day: string) => Date.parse(`${day}T00:00:00Z`) / 86_400_000;

async function main() {
  const batch = process.argv.slice(2).find((arg) => arg !== "--") ?? "tuning-1";
  if (batch !== CHECK_BATCH && !/^tuning-\d+$/.test(batch)) throw new Error(`Batch must be "tuning-<n>" or "check", not "${batch}".`);

  const version = scoringVersion();
  const scoresFile = path.join(DATA_DIR, `scores-${version}.json`);
  if (!existsSync(scoresFile)) throw new Error(`No scores for scoring version ${version}. Run evals/section-scoring/run.ts first.`);
  const scores = readJson<Record<string, StoryScores>>(scoresFile);
  const shown = new Set(readJson<{ id: number }[]>(path.join(DATA_DIR, "shown-7ca6fcd6.json")).map((row) => row.id));
  const vectors = readJson<Record<string, number[]>>(path.join(DATA_DIR, "embeddings.json"));

  const rows = await readOnlyQuery<StoryRow>(
    `select id, to_char(day, 'YYYY-MM-DD') "day", headline, summary, source, url, category, importance_score
     from newsletter.stories where id = any($1::int[]) order by id`,
    [Object.keys(scores).map(Number)],
  );
  if (!rows) throw new Error("DATABASE_URL is not set (use the Neon dev branch).");

  let sets: Sets | null = existsSync(SETS_FILE) ? readJson<Sets>(SETS_FILE) : null;
  const lastDay = rows.reduce((max, row) => (row.day > max ? row.day : max), "");
  const window = sets?.window ?? {
    from: new Date((dayNumber(lastDay) - (7 * WEEKS - 1)) * 86_400_000).toISOString().slice(0, 10),
    to: lastDay,
  };
  const inWindow = rows.filter((row) => row.day >= window.from && row.day <= window.to);
  const byId = new Map(inWindow.map((row) => [row.id, row]));
  const pool: PoolStory[] = inWindow.map((row) => {
    const bucket = normalizeCategory(row.category);
    return {
      id: row.id,
      extractionKind: bucket === "research" || bucket === "tools" ? bucket : "general",
      extractionImportance: row.importance_score ?? 0,
      shown: shown.has(row.id),
      scores: scores[row.id],
    };
  });
  console.log(`Scoring version ${version}. Window ${window.from} to ${window.to}: ${pool.length} scored stories.`);

  if (!sets) {
    sets = {
      about:
        "The fixed sets of the section-scoring golden set (#177), by story id. The check set is a plain random sample, never tuned on; its 'hidden' stories are labeled with no recommendation. Each tuning batch is picked with the scoring version of its time (golden-set.ts). Rebuild a page with build-batch.ts.",
      seed: SEED,
      window,
      check: pickCheckSet(pool, { size: CHECK_SIZE, hidden: CHECK_HIDDEN, seed: SEED }),
      batches: [],
    };
    console.log(`Fixed the check set: ${sets.check.ids.length} stories, ${sets.check.hidden.length} with no recommendation.`);
  }

  let ids: number[];
  if (batch === CHECK_BATCH) {
    ids = sets.check.ids;
  } else {
    const existing = sets.batches.find((entry) => entry.batch === batch);
    if (existing) {
      ids = existing.ids;
    } else {
      const similar = (a: number, b: number) => {
        const va = vectors[a];
        const vb = vectors[b];
        if (!va || !vb) return false;
        if (Math.abs(dayNumber(byId.get(a)!.day) - dayNumber(byId.get(b)!.day)) > SAME_EVENT_DAYS) return false;
        let dot = 0;
        for (let i = 0; i < va.length; i++) dot += va[i] * vb[i];
        return dot >= SAME_EVENT_SIMILARITY;
      };
      const eventOf = groupEvents(
        pool.map((story) => story.id),
        similar,
      );
      const exclude = new Set([...sets.check.ids, ...sets.batches.flatMap((entry) => entry.ids)]);
      ids = pickTuningBatch(pool, { size: BATCH_SIZE, seed: SEED + sets.batches.length + 1, exclude, eventOf });
      sets.batches.push({ batch, scoringVersion: version, picked: new Date().toISOString().slice(0, 10), ids });
      console.log(`Picked ${batch}: ${ids.length} stories.`);
    }
  }
  writeFileSync(SETS_FILE, `${JSON.stringify(sets, null, 2)}\n`);

  const hidden = new Set(batch === CHECK_BATCH ? sets.check.hidden : []);
  const poolById = new Map(pool.map((story) => [story.id, story]));
  const stories: PageStory[] = ids.map((id) => {
    const row = byId.get(id);
    const story = poolById.get(id);
    if (!row || !story) throw new Error(`Story ${id} of ${batch} is not in the window on this database.`);
    const text = { headline: cleanText(row.headline), summary: cleanText(row.summary), source: row.source ?? "" };
    return {
      id,
      inputHash: hashInput(text),
      ...text,
      url: row.url,
      recommendation: hidden.has(id) ? null : recommend(story.scores),
    };
  });

  const counts: Record<string, number> = {};
  for (const id of ids) for (const hard of hardCases(poolById.get(id)!)) counts[hard] = (counts[hard] ?? 0) + 1;
  const kinds: Record<string, number> = {};
  for (const story of stories) if (story.recommendation) kinds[story.recommendation.kind] = (kinds[story.recommendation.kind] ?? 0) + 1;
  console.log(`Hard cases in ${batch}: ${JSON.stringify(counts)}. Recommended kinds: ${JSON.stringify(kinds)}.`);

  const script = buildSync({
    entryPoints: [path.resolve(__dirname, "page-ui.ts")],
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
    tsconfig: path.resolve(__dirname, "../../tsconfig.json"),
  }).outputFiles[0].text;
  const pageFile = path.join(DATA_DIR, `label-${batch}.html`);
  writeFileSync(
    pageFile,
    buildPage({ batch, scoringVersion: version, levels: [...IMPORTANCE_LEVELS], stories, script }),
  );
  console.log(`Wrote ${pageFile}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
