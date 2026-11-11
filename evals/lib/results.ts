import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { REASONING_EFFORTS } from "@/src/lib/reasoning-effort";

/** The lowest and highest per-repeat value of a metric: a share (0 to 1) for a count, the value for a number. */
export interface Spread {
  min: number;
  max: number;
}

/** A count (`hits` of `n`) or a plain number. `spread` is set when two or more repeats gave the metric. */
export type Metric = ({ name: string; hits: number; n: number } | { name: string; value: number }) & { spread?: Spread };

/** One (model, effort) of a results file. Metrics, ids and our own headlines only: never third-party text. */
export interface ResultRow {
  model: string;
  /** `null` is the API default (no `reasoning` field); "n/a" is a call that takes no effort. */
  effort: string | null;
  /** Item runs: items x repeats. */
  n: number;
  errors: number;
  metrics: Metric[];
  /** Time of `run`, the model calls only (grading is not timed), over the runs without an error. */
  latencyMs: { p50: number | null; p95: number | null };
  /** Model cost of one item run, per-call tool fees included, or null when the model has no price in usage.ts. */
  costPerCallUsd: number | null;
  /** Cost of the judge for one item run, or null when the eval uses no judge. */
  judgeCostPerCallUsd: number | null;
  /** Web search calls per item run, when the call searched. */
  webSearchesPerCall?: number;
  /** Runs the judge graded, of the runs it tried (EVAL_JUDGE_REPEATS can leave runs out). Evals with a grade step. */
  graded?: { hits: number; n: number };
  /** The cost of the work shared across the whole sweep (reads and verdicts done once), not in the per-call costs. */
  sharedCostUsd?: number;
  date: string;
  gitSha: string;
}

export interface ResultsFile {
  task: string;
  title: string;
  /** Lines under the title: what is measured, ground truth, data source. */
  notes: string[];
  /** The metric columns to show, in order. Default: every metric of the rows. All metrics stay in the stored rows. */
  columns?: string[];
  rows: ResultRow[];
}

const ROOT = join(__dirname, "..", "..");
const STORE_START = "<!-- eval-results";
/** The block of results files written before d1da5b8: the rows only. */
const OLD_STORE_START = "<!-- eval-rows";
const STORE_END = "-->";

export function resultsPath(task: string): string {
  return join(ROOT, "evals", "results", `${task}.md`);
}

export function rawOutputPath(task: string): string {
  return join(ROOT, "evals", "out", `${task}.json`);
}

/** 0 decimals from 100, 1 from 10, else 2; no trailing zeros. */
export function roundValue(value: number): string {
  const size = Math.abs(value);
  const decimals = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return String(Number(value.toFixed(decimals)));
}

const percent = (share: number) => Math.round(100 * share);

/** The spread is shown when the repeats differ; when they agree, the total says it all. */
const differs = (spread: Spread | undefined): spread is Spread => spread !== undefined && spread.min !== spread.max;

function formatMetric(metric: Metric | undefined): string {
  if (!metric) return "–";
  if ("hits" in metric) {
    const total = `${metric.hits}/${metric.n} (${metric.n ? percent(metric.hits / metric.n) : 0}%`;
    return differs(metric.spread) ? `${total}; ${percent(metric.spread.min)}–${percent(metric.spread.max)}%)` : `${total})`;
  }
  const value = roundValue(metric.value);
  return differs(metric.spread) ? `${value} (${roundValue(metric.spread.min)}–${roundValue(metric.spread.max)})` : value;
}

function formatSeconds(ms: number | null): string {
  return ms === null ? "–" : `${(ms / 1000).toFixed(1)} s`;
}

function formatUsd(usd: number | null | undefined): string {
  if (usd === null || usd === undefined) return "unknown";
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

interface Column {
  header: string;
  cell: (row: ResultRow) => string | null;
}

/** The table's columns: the metrics, then the standard ones. A column with no value in any row is left out. */
function tableColumns(file: ResultsFile): Column[] {
  const allMetrics = [...new Set(file.rows.flatMap((row) => row.metrics.map((metric) => metric.name)))];
  const metricNames = file.columns ?? allMetrics;
  const metric = (name: string): Column => ({
    header: name,
    cell: (row) => {
      const found = row.metrics.find((entry) => entry.name === name);
      return found ? formatMetric(found) : null;
    },
  });
  const columns: Column[] = [
    { header: "Model", cell: (row) => row.model },
    { header: "Effort", cell: (row) => row.effort ?? "api default" },
    ...metricNames.map(metric),
    { header: "Errors", cell: (row) => String(row.errors) },
    { header: "Graded", cell: (row) => (row.graded ? `${row.graded.hits}/${row.graded.n}` : null) },
    { header: "p50", cell: (row) => (row.latencyMs.p50 === null ? null : formatSeconds(row.latencyMs.p50)) },
    { header: "p95", cell: (row) => (row.latencyMs.p95 === null ? null : formatSeconds(row.latencyMs.p95)) },
    { header: "Searches per call", cell: (row) => (row.webSearchesPerCall === undefined ? null : roundValue(row.webSearchesPerCall)) },
    { header: "Cost per call", cell: (row) => formatUsd(row.costPerCallUsd) },
    { header: "Judge cost per call", cell: (row) => (row.judgeCostPerCallUsd === null ? null : formatUsd(row.judgeCostPerCallUsd)) },
    { header: "n", cell: (row) => String(row.n) },
    { header: "Date", cell: (row) => row.date },
    { header: "Git sha", cell: (row) => row.gitSha },
  ];
  return columns.filter((column) => file.rows.some((row) => column.cell(row) !== null));
}

/** One line per run that shared work across configs: its cost is not in the per-call columns. */
function sharedCostLines(rows: ResultRow[]): string[] {
  const runs = new Map<string, string>();
  for (const row of rows) {
    if (row.sharedCostUsd === undefined) continue;
    const key = `${row.date} (${row.gitSha})`;
    runs.set(key, `Shared work of the run of ${key}, done once for all its configs: ${formatUsd(row.sharedCostUsd)}.`);
  }
  return [...runs.values()];
}

export function renderResults(file: ResultsFile): string {
  const columns = tableColumns(file);
  const header = columns.map((column) => column.header);
  const lines = file.rows.map((row) => columns.map((column) => column.cell(row) ?? "–"));
  const table = [header, header.map(() => "---"), ...lines].map((cells) => `| ${cells.join(" | ")} |`);
  const shared = sharedCostLines(file.rows);
  const stored = { title: file.title, notes: file.notes, ...(file.columns ? { columns: file.columns } : {}), rows: file.rows };
  return [
    `# ${file.title}`,
    "",
    `Written by \`npm run eval -- evals/${file.task}\`; \`npm run eval:rerender -- ${file.task}\` rebuilds it from the`,
    "rows stored below. Do not edit by hand. A run replaces the rows of the model and effort it ran; other rows stay.",
    "Latency and cost are for one item run; a range in brackets is the lowest and highest repeat. See evals/README.md.",
    "",
    ...file.notes.flatMap((note) => [note, ""]),
    ...table,
    "",
    ...(shared.length ? [...shared, ""] : []),
    STORE_START,
    JSON.stringify(stored),
    STORE_END,
    "",
  ].join("\n");
}

/** What a results file stores. Files from before d1da5b8 stored only rows: their title and notes are read from the text. */
export function readStored(markdown: string): Omit<ResultsFile, "task"> | null {
  const start = markdown.indexOf(STORE_START);
  if (start !== -1) {
    const end = markdown.indexOf(STORE_END, start);
    return JSON.parse(markdown.slice(start + STORE_START.length, end).trim()) as Omit<ResultsFile, "task">;
  }
  const oldStart = markdown.indexOf(OLD_STORE_START);
  if (oldStart === -1) return null;
  const end = markdown.indexOf(STORE_END, oldStart);
  const rows = JSON.parse(markdown.slice(oldStart + OLD_STORE_START.length, end).trim()) as ResultRow[];
  // Old layout: "# title", the two-line header, then each note as a paragraph, then the table.
  const paragraphs = markdown.slice(0, markdown.indexOf("\n|")).split(/\n\s*\n/).map((part) => part.trim());
  const title = paragraphs[0].replace(/^#\s*/, "");
  return { title, notes: paragraphs.slice(2).filter(Boolean), rows };
}

/** The rows stored at the end of a results file, so a later run can keep the configs it did not run. */
export function readRows(markdown: string): ResultRow[] {
  return readStored(markdown)?.rows ?? [];
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

/** Rebuilds `evals/results/<task>.md` from its stored rows, with no API calls. `change` replaces stored fields. */
export function rerenderResults(task: string, change: Partial<Pick<ResultsFile, "title" | "notes" | "columns">> = {}): string {
  const path = resultsPath(task);
  const stored = readStored(readFileSync(path, "utf8"));
  if (!stored) throw new Error(`${path} has no stored rows`);
  writeFile(path, renderResults({ task, ...stored, ...change }));
  return path;
}
