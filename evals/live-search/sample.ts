/**
 * Live search backtest (#86). For each past issue date, run each search source over the window the issue covered,
 * then score the results against the stories the owner published that day.
 *
 * Run (reads the Neon dev branch, read-only; calls paid APIs, about $0.15 per date, $0.25 with Grok):
 *   DATABASE_URL=<dev> OPENROUTER_API_KEY=... npx vite-node --config evals/vitest.eval.config.ts \
 *     evals/live-search/sample.ts -- 2026-10-20 2026-11-04
 * Env: LIVE_SEARCH_PROVIDERS=exa,sonar,grok,hn (default: exa,sonar,hn). Exa runs through the Composio CLI.
 * Output: evals/data/live-search/<run>/ (gitignored: third-party headlines) and a summary on stdout.
 */
import { execFile } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { EXTRACTION_CATEGORY_RULES, EXTRACTION_IMPORTANCE_RUBRIC, STORY_CATEGORIES } from "@/src/pipeline/ingest/extract";

import {
  EXA_DOMAIN_PLANS,
  EXA_QUERIES,
  EXCLUDED_DOMAINS,
  GROK_HANDLES,
  grokPrompt,
  HN_AI_WORDS,
  HN_MIN_POINTS,
  SONAR_FOCUSES,
  SONAR_SCHEMA,
  sonarPrompt,
} from "./plans";
import { isExcluded, normalizeUrl, windowFor, type Window } from "./window";

const run = promisify(execFile);
const JUDGE_MODEL = "openai/gpt-6-luna";

type Provider = "exa" | "sonar" | "grok" | "hn";
type ResultProvider = Provider | "exa1p";
interface Candidate {
  provider: ResultProvider;
  plan: string;
  title: string;
  url: string;
  publishedDate?: string;
  /** The X post, for Grok results that also link an article. */
  postUrl?: string;
}
interface PublishedStory {
  id: number;
  section: string;
  is_lead: boolean | null;
  headline: string;
  url: string | null;
}

const costs: Record<string, number> = {};
const rawGrok: string[] = [];
function addCost(key: string, usd: number) {
  costs[key] = (costs[key] ?? 0) + usd;
}

const day = (d: Date) => d.toISOString().slice(0, 10);
const usDay = (d: Date) => `${String(d.getUTCMonth() + 1).padStart(2, "0")}/${String(d.getUTCDate()).padStart(2, "0")}/${d.getUTCFullYear()}`;
const excluded = (url: string) => isExcluded(url, EXCLUDED_DOMAINS);

interface ChatResponse {
  choices: { message: { content: string | null } }[];
  usage?: { cost?: number };
  error?: unknown;
}

async function openRouter(body: object, costKey: string): Promise<ChatResponse> {
  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, usage: { include: true } }),
  });
  const json = (await res.json()) as ChatResponse;
  if (!res.ok || json.error) throw new Error(`OpenRouter ${res.status}: ${JSON.stringify(json.error ?? json).slice(0, 300)}`);
  addCost(costKey, json.usage?.cost ?? 0);
  return json;
}

async function exa(w: Window): Promise<Candidate[]> {
  const out: Candidate[] = [];
  const plans = [
    ...EXA_QUERIES.map((q) => ({ ...q, news: true, domains: undefined as string[] | undefined })),
    ...EXA_DOMAIN_PLANS,
  ];
  for (const q of plans) {
    const args = {
      query: q.query,
      numResults: 10,
      startPublishedDate: w.start.toISOString(),
      endPublishedDate: w.end.toISOString(),
      ...(q.news ? { category: "news" } : {}),
      ...(q.domains ? { includeDomains: q.domains } : { excludeDomains: EXCLUDED_DOMAINS }),
    };
    try {
      const { stdout } = await run("composio", ["execute", "EXA_SEARCH", "-d", JSON.stringify(args)], { maxBuffer: 1 << 24 });
      const json = JSON.parse(stdout);
      if (!json.successful) throw new Error(json.error);
      addCost("exa", Number(json.instantCharge?.amount ?? 0.007));
      for (const r of json.data.results ?? []) {
        out.push({ provider: q.domains ? "exa1p" : "exa", plan: q.key, title: r.title ?? "", url: r.url, publishedDate: r.publishedDate });
      }
    } catch (e) {
      console.error(`Exa ${q.key}: ${String((e as Error).message).slice(0, 200)}`);
    }
  }
  return out;
}

async function sonar(w: Window): Promise<Candidate[]> {
  const out: Candidate[] = [];
  for (const f of SONAR_FOCUSES) {
    const json = await openRouter(
      {
        model: "perplexity/sonar",
        messages: [{ role: "user", content: sonarPrompt(f.focus, day(w.start), day(w.end)) }],
        search_after_date_filter: usDay(w.start),
        search_before_date_filter: usDay(w.end),
        web_search_options: { search_context_size: "low" },
        response_format: { type: "json_schema", json_schema: { name: "stories", schema: SONAR_SCHEMA } },
      },
      "sonar",
    );
    const stories = parseJson<{ stories: { headline: string; url: string; published_date: string }[] }>(json.choices[0].message.content ?? "")?.stories ?? [];
    for (const s of stories) {
      out.push({ provider: "sonar", plan: f.key, title: s.headline, url: s.url, publishedDate: s.published_date });
    }
  }
  return out;
}

async function grok(w: Window): Promise<Candidate[]> {
  const toDate = day(w.end);
  const json = await openRouter(
    {
      model: "x-ai/grok-4.3",
      messages: [{ role: "user", content: grokPrompt(day(w.start), toDate) }],
      plugins: [{ id: "web", max_results: 3, x_search: { allowed_x_handles: GROK_HANDLES, from_date: day(w.start), to_date: toDate } }],
    },
    "grok",
  );
  const text: string = json.choices[0].message.content ?? "";
  rawGrok.push(text);
  const lines = text.split("\n");
  const out: Candidate[] = [];
  for (const line of lines) {
    const post = line.match(/https:\/\/(?:x|twitter)\.com\/[A-Za-z0-9_]+\/status\/\d+/)?.[0];
    if (!post) continue;
    const clean = line.replace(/\[\[\d+\]\]\([^)]*\)/g, "").replace(/^[\s*\-\d.]+/, "");
    const parts = clean.split("|").map((p) => p.trim().replace(/^\*+|\*+$/g, ""));
    const urls = [...clean.matchAll(/https?:\/\/[^\s|)\]]+/g)].map((m) => m[0]);
    const article = urls.find((u) => !/\/\/(x|twitter)\.com\//.test(u));
    const date = clean.match(/\d{4}-\d{2}-\d{2}/)?.[0];
    out.push({ provider: "grok", plan: "x", title: parts[0] || clean.slice(0, 120), url: article ?? post, postUrl: post, publishedDate: date });
  }
  return out;
}

async function hn(w: Window): Promise<Candidate[]> {
  const s = Math.floor(w.start.getTime() / 1000);
  const e = Math.floor(w.end.getTime() / 1000);
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=500&numericFilters=created_at_i>${s},created_at_i<${e},points>${HN_MIN_POINTS}`;
  const json = (await (await fetch(url)).json()) as { hits?: { title: string; url: string | null; created_at: string }[] };
  return (json.hits ?? [])
    .filter((h) => h.url && HN_AI_WORDS.test(h.title))
    .map((h) => ({ provider: "hn" as const, plan: "front", title: h.title, url: h.url ?? "", publishedDate: h.created_at }));
}

function parseJson<T>(text: string): T | null {
  try {
    return JSON.parse(text);
  } catch {
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  }
}

async function judge<T>(schemaName: string, schema: object, prompt: string): Promise<T | null> {
  const json = await openRouter(
    {
      model: JUDGE_MODEL,
      reasoning: { effort: "medium" },
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } },
    },
    "judge",
  );
  return parseJson<T>(json.choices[0].message.content ?? "");
}

/** For each published story, the candidates that report the same news event. */
async function match(published: PublishedStory[], cands: { i: number; title: string; url: string }[]) {
  const schema = {
    type: "object",
    properties: {
      matches: {
        type: "array",
        items: {
          type: "object",
          properties: { story_id: { type: "integer" }, candidate_ids: { type: "array", items: { type: "integer" } } },
          required: ["story_id", "candidate_ids"],
          additionalProperties: false,
        },
      },
    },
    required: ["matches"],
    additionalProperties: false,
  };
  const prompt = `Match newsletter stories to search results. For every published story, list the ids of the search results that report the SAME news event (same launch, same paper, same deal). A result about a different event from the same company is not a match. An empty list is fine.

Published stories:
${published.map((p) => `${p.id}. ${p.headline} — ${p.url ?? ""}`).join("\n")}

Search results:
${cands.map((c) => `${c.i}. ${c.title} — ${c.url}`).join("\n")}`;
  const out = await judge<{ matches: { story_id: number; candidate_ids: number[] }[] }>("matches", schema, prompt);
  return new Map<number, number[]>((out?.matches ?? []).map((m) => [m.story_id, m.candidate_ids]));
}

/** Category and importance with the extraction rubric, from the title and link alone. */
async function grade(cands: { i: number; title: string; url: string }[]) {
  const schema = {
    type: "object",
    properties: {
      grades: {
        type: "array",
        items: {
          type: "object",
          properties: {
            i: { type: "integer" },
            kind: { type: "string", enum: ["news", "roundup", "not_ai", "not_news"] },
            category: { type: "string", enum: [...STORY_CATEGORIES] },
            importance: { type: "integer" },
          },
          required: ["i", "kind", "category", "importance"],
          additionalProperties: false,
        },
      },
    },
    required: ["grades"],
    additionalProperties: false,
  };
  const grades = new Map<number, { kind: string; category: string; importance: number }>();
  for (let k = 0; k < cands.length; k += 60) {
    const chunk = cands.slice(k, k + 60);
    const prompt = `Grade each search result for an AI newsletter, from its title and link only.
kind: "news" for a single AI news event; "roundup" for a newsletter, digest, list of stories, or archive page; "not_ai" if it is not about AI; "not_news" for opinion, explainers, how-tos, or evergreen pages.

## Category
${EXTRACTION_CATEGORY_RULES}

## Importance
${EXTRACTION_IMPORTANCE_RUBRIC}

Results:
${chunk.map((c) => `${c.i}. ${c.title} — ${c.url}`).join("\n")}`;
    const out = await judge<{ grades: { i: number; kind: string; category: string; importance: number }[] }>("grades", schema, prompt);
    for (const g of out?.grades ?? []) grades.set(g.i, g);
  }
  return grades;
}

async function publishedOn(issueDate: string): Promise<PublishedStory[]> {
  const rows = await readOnlyQuery<PublishedStory>(
    `select st.id, s.section, s.is_lead, st.headline, coalesce(s.url, st.url) as url
       from newsletter.issues i join newsletter.issue_stories s on s.issue_id = i.id join newsletter.stories st on st.id = s.story_id
      where i.issue_date = $1 and i.published_at is not null order by s.section, s.position`,
    [issueDate],
  );
  if (!rows) throw new Error("DATABASE_URL is not set (Neon dev branch).");
  return rows;
}

interface BoardStory {
  id: number;
  day: string;
  headline: string;
  url: string | null;
  importance_score: number | null;
}
/** The board around an issue: every story ingested from 3 days before to 1 day after it. */
async function boardAround(issueDate: string): Promise<BoardStory[]> {
  const rows = await readOnlyQuery<BoardStory>(
    `select id, to_char(day, 'YYYY-MM-DD') as day, headline, url, importance_score from newsletter.stories
      where day between $1::date - 3 and $1::date + 1 and headline is not null order by day, id`,
    [issueDate],
  );
  return rows ?? [];
}

/** For each search result, the board story that reports the same news event, or 0. */
async function matchBoard(board: BoardStory[], cands: { i: number; title: string; url: string }[]) {
  const schema = {
    type: "object",
    properties: {
      results: {
        type: "array",
        items: {
          type: "object",
          properties: { i: { type: "integer" }, board_id: { type: "integer" } },
          required: ["i", "board_id"],
          additionalProperties: false,
        },
      },
    },
    required: ["results"],
    additionalProperties: false,
  };
  const out = new Map<number, number>();
  const boardText = board.map((b) => `${b.id}. ${b.headline} — ${b.url ?? ""}`).join("\n");
  for (let k = 0; k < cands.length; k += 60) {
    const chunk = cands.slice(k, k + 60);
    const res = await judge<{ results: { i: number; board_id: number }[] }>(
      "board",
      schema,
      `For every search result, give the id of the board story that reports the SAME news event (same launch, same paper, same deal), or 0 if none does. A story about a different event from the same company is not a match.

Board stories:
${boardText}

Search results:
${chunk.map((c) => `${c.i}. ${c.title} — ${c.url}`).join("\n")}`,
    );
    for (const r of res?.results ?? []) out.set(r.i, r.board_id);
  }
  return out;
}

const PROVIDERS: Record<Provider, (w: Window) => Promise<Candidate[]>> = { exa, sonar, grok, hn };

async function main() {
  const dates = process.argv.slice(2).filter((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
  const providers = (process.env.LIVE_SEARCH_PROVIDERS ?? "exa,sonar,hn").split(",") as Provider[];
  const runDir = path.resolve("evals/data/live-search", new Date().toISOString().replace(/[:.]/g, "-"));
  mkdirSync(runDir, { recursive: true });
  const rows: string[] = [];

  for (const date of dates) {
    const w = windowFor(date);
    const published = await publishedOn(date);
    const all: Candidate[] = [];
    for (const p of providers) {
      try {
        all.push(...(await PROVIDERS[p](w)));
      } catch (e) {
        console.error(`${date} ${p}: ${(e as Error).message}`);
      }
    }
    // Drop excluded domains and results dated outside the window (a day of slack: some dates are only a day).
    const inWindow = all.filter((c) => {
      if (!c.url?.startsWith("http") || excluded(c.url)) return false;
      if (!c.publishedDate) return true;
      const t = Date.parse(c.publishedDate);
      return Number.isNaN(t) || (t >= w.start.getTime() - 86400e3 && t <= w.end.getTime());
    });
    const byUrl = new Map<string, { i: number; title: string; url: string; from: Candidate[] }>();
    for (const c of inWindow) {
      const key = normalizeUrl(c.url);
      const entry = byUrl.get(key) ?? { i: byUrl.size + 1, title: c.title, url: c.url, from: [] };
      entry.from.push(c);
      byUrl.set(key, entry);
    }
    const unique = [...byUrl.values()];
    const board = await boardAround(date);
    const [matches, grades, onBoard] = await Promise.all([match(published, unique), grade(unique), matchBoard(board, unique)]);
    const boardIds = new Set(board.map((b) => b.id));
    const strongBoard = board.filter((b) => (b.importance_score ?? 0) >= 4 && b.day <= date);
    const matchedIds = new Set([...matches.values()].flat());

    const isHeadline = (p: PublishedStory) => p.section === "headlines" || p.is_lead;
    const found = (pred: (c: Candidate) => boolean) => (p: PublishedStory) =>
      (matches.get(p.id) ?? []).some((i) => unique.find((u) => u.i === i)?.from.some(pred));
    const shown: ResultProvider[] = [...providers, ...(providers.includes("exa") ? (["exa1p"] as const) : [])];
    const combos: [string, (c: Candidate) => boolean][] = [
      ...shown.map((p) => [p, (c: Candidate) => c.provider === p] as [string, (c: Candidate) => boolean]),
      ["exa+exa1p+hn", (c: Candidate) => ["exa", "exa1p", "hn"].includes(c.provider)],
      ["all", () => true],
    ];
    for (const [name, pred] of combos) {
      const mine = unique.filter((u) => u.from.some(pred));
      const g = mine.map((u) => grades.get(u.i));
      const news = g.filter((x) => x?.kind === "news").length;
      const strong = (u: { i: number }) => grades.get(u.i)?.kind === "news" && (grades.get(u.i)?.importance ?? 0) >= 4;
      const strongNew = mine.filter((u) => strong(u) && !boardIds.has(onBoard.get(u.i) ?? 0)).length;
      const boardHit = new Set(mine.map((u) => onBoard.get(u.i)).filter((id) => id && boardIds.has(id)));
      const strongBoardFound = strongBoard.filter((b) => boardHit.has(b.id)).length;
      const hl = published.filter(isHeadline);
      rows.push(
        [date, name, mine.length, `${published.filter(found(pred)).length}/${published.length}`, `${hl.filter(found(pred)).length}/${hl.length}`, `${strongBoardFound}/${strongBoard.length}`, news, strongNew].join(" | "),
      );
    }

    writeFileSync(
      path.join(runDir, `${date}.json`),
      JSON.stringify(
        {
          window: { start: w.start, end: w.end },
          published: published.map((p) => ({ ...p, matched: (matches.get(p.id) ?? []).map((i) => unique.find((u) => u.i === i)) })),
          candidates: unique.map((u) => ({
            ...u,
            grade: grades.get(u.i),
            matchesPublished: matchedIds.has(u.i),
            board: board.find((b) => b.id === onBoard.get(u.i)) ?? null,
          })),
          grokRaw: rawGrok.splice(0),
        },
        null,
        2,
      ),
    );
  }

  const header =
    "date | source | results | published found | headlines found | board 4+ found | news results | strong new (importance ≥ 4, not on the board)";
  const summary = [header, ...rows, "", `cost USD: ${JSON.stringify(Object.fromEntries(Object.entries(costs).map(([k, v]) => [k, +v.toFixed(4)])))}`].join("\n");
  writeFileSync(path.join(runDir, "summary.txt"), summary);
  console.log(summary);
  console.log(`\nwrote ${runDir}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
