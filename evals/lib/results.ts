import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { REASONING_EFFORTS } from "@/src/lib/reasoning-effort";

/** A count (`hits` of `n`) or a plain number. */
export type Metric = { name: string; hits: number; n: number } | { name: string; value: number };

/** One (model, effort) of a results file. Metrics, ids and our own headlines only: never third-party text. */
export interface ResultRow {
  model: string;
  /** `null` is the API default (no `reasoning` field); "n/a" is a call that takes no effort. */
  effort: string | null;
  /** Item runs: items x repeats. */
  n: number;
  errors: number;
  metrics: Metric[];
  latencyMs: { p50: number | null; p95: number | null };
  /** Model cost of one item run, or null when the model has no price in usage.ts. */
  costPerCallUsd: number | null;
  /** Cost of the judge for one item run, or null when the eval uses no judge. */
  judgeCostPerCallUsd: number | null;
  date: string;
  gitSha: string;
}

export interface ResultsFile {
  task: string;
  title: string;
  /** Lines under the title: what is measured, ground truth, data source. */
  notes: string[];
  rows: ResultRow[];
}

const ROOT = join(__dirname, "..", "..");
const ROWS_START = "<!-- eval-rows";
const ROWS_END = "-->";

export function resultsPath(task: string): string {
  return join(ROOT, "evals", "results", `${task}.md`);
}

export function rawOutputPath(task: string): string {
  return join(ROOT, "evals", "out", `${task}.json`);
}

function formatMetric(metric: Metric | undefined): string {
  if (!metric) return "–";
  if ("hits" in metric) return `${metric.hits}/${metric.n} (${metric.n ? Math.round((100 * metric.hits) / metric.n) : 0}%)`;
  return Number.isInteger(metric.value) ? String(metric.value) : metric.value.toFixed(2);
}

function formatSeconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

function formatUsd(usd: number | null): string {
  if (usd === null) return "unknown";
  return usd >= 0.001 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(6)}`;
}

function effortOrder(effort: string | null): number {
  const index = (REASONING_EFFORTS as readonly string[]).indexOf(effort ?? "");
  return index === -1 ? REASONING_EFFORTS.length : index;
}

/** The rows of the configs that ran replace the old rows of the same (model, effort). The others stay. */
export function mergeRows(old: ResultRow[], fresh: ResultRow[]): ResultRow[] {
  const key = (row: ResultRow) => `${row.model}|${row.effort}`;
  const freshKeys = new Set(fresh.map(key));
  return [...old.filter((row) => !freshKeys.has(key(row))), ...fresh].sort(
    (a, b) => a.model.localeCompare(b.model) || effortOrder(a.effort) - effortOrder(b.effort)
  );
}

export function renderResults(file: ResultsFile): string {
  const metricNames = [...new Set(file.rows.flatMap((row) => row.metrics.map((metric) => metric.name)))];
  const withJudge = file.rows.some((row) => row.judgeCostPerCallUsd !== null);
  const header = [
    "Model",
    "Effort",
    ...metricNames,
    "Errors",
    "p50",
    "p95",
    "Cost per call",
    ...(withJudge ? ["Judge cost per call"] : []),
    "n",
    "Date",
    "Git sha",
  ];
  const lines = file.rows.map((row) => {
    const byName = new Map(row.metrics.map((metric) => [metric.name, metric]));
    return [
      row.model,
      row.effort ?? "api default",
      ...metricNames.map((name) => formatMetric(byName.get(name))),
      String(row.errors),
      formatSeconds(row.latencyMs.p50),
      formatSeconds(row.latencyMs.p95),
      formatUsd(row.costPerCallUsd),
      ...(withJudge ? [formatUsd(row.judgeCostPerCallUsd)] : []),
      String(row.n),
      row.date,
      row.gitSha,
    ];
  });
  const table = [header, header.map(() => "---"), ...lines].map((cells) => `| ${cells.join(" | ")} |`);
  return [
    `# ${file.title}`,
    "",
    `Written by \`npm run eval -- evals/${file.task}\`. Do not edit by hand. A run replaces the rows of the model and`,
    "effort it ran; other rows stay. Latency and cost are for one item run. See evals/README.md.",
    "",
    ...file.notes.flatMap((note) => [note, ""]),
    ...table,
    "",
    ROWS_START,
    JSON.stringify(file.rows),
    ROWS_END,
    "",
  ].join("\n");
}

/** The rows stored at the end of a results file, so a later run can keep the configs it did not run. */
export function readRows(markdown: string): ResultRow[] {
  const start = markdown.indexOf(ROWS_START);
  if (start === -1) return [];
  const end = markdown.indexOf(ROWS_END, start);
  return JSON.parse(markdown.slice(start + ROWS_START.length, end).trim()) as ResultRow[];
}

/** The short sha of HEAD, with "+changes" when the working tree has uncommitted changes. */
export function gitSha(): string {
  try {
    const sha = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: ROOT, encoding: "utf8" }).trim();
    const dirty = execFileSync("git", ["status", "--porcelain"], { cwd: ROOT, encoding: "utf8" }).trim() !== "";
    return dirty ? `${sha}+changes` : sha;
  } catch {
    return "unknown";
  }
}

function writeFile(path: string, text: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/**
 * Writes `evals/results/<task>.md` (committed) and the raw run as `evals/out/<task>.json` (gitignored).
 * Returns the path of the results file.
 */
export function writeResults(file: ResultsFile, raw: unknown): string {
  const path = resultsPath(file.task);
  const old = existsSync(path) ? readRows(readFileSync(path, "utf8")) : [];
  writeFile(path, renderResults({ ...file, rows: mergeRows(old, file.rows) }));
  writeFile(rawOutputPath(file.task), `${JSON.stringify(raw, null, 2)}\n`);
  return path;
}
