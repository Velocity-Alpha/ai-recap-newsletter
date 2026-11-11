import { createJudge, type Judge } from "@/evals/lib/judge";
import { gitSha, writeResults, type Metric, type ResultRow, type ResultsFile } from "@/evals/lib/results";
import { effortLabel, sweepConfigs, type EvalConfig, type EvalSettings } from "@/evals/lib/settings";
import { mapLimit, percentile } from "@/evals/lib/stats";
import { costUsd, priceOf, recordingClient, recordingFetch, UsageRecorder, type Price, type RecordingClient, type Usage } from "@/evals/lib/usage";

/** What `run` gets for one item run. Pass `client` or `fetch` to the call site so its usage is counted. */
export interface RunContext {
  config: EvalConfig;
  /** 0 to EVAL_REPEATS - 1. */
  repeat: number;
  /** A Responses API client that records usage for this config. */
  client: RecordingClient;
  /** A fetch that records usage for this config (for the Decisions API). */
  fetch: typeof fetch;
  /** The judge (EVAL_JUDGE_MODEL), for evals that grade text. Its cost is shown apart. */
  judge: Judge;
}

/** One item run. `output` is null when `run` threw. */
export interface Outcome<Item, Output> {
  item: Item;
  id: string;
  repeat: number;
  latencyMs: number;
  output: Output | null;
  error: string | null;
}

export interface SweepSpec<Item, Output> {
  /** The folder name under evals/, and the name of the results file. */
  task: string;
  title: string;
  /** Lines for the results file: what is measured, ground truth, data source. No third-party text. */
  notes: string[];
  settings: EvalSettings;
  items: Item[];
  id: (item: Item) => string;
  /** Calls the real call site for one item, with `context.config`'s model and effort. */
  run: (item: Item, context: RunContext) => Promise<Output>;
  /** The metrics of one config, from all its outcomes (errors included). Pure: unit-test it. */
  score: (outcomes: Outcome<Item, Output>[]) => Metric[];
  /** Extra fields for each outcome in the raw JSON (evals/out/, gitignored). Ids, numbers and our headlines. */
  raw?: (outcome: Outcome<Item, Output>) => Record<string, unknown>;
  /** The price of a model. Default: PRICES in usage.ts. */
  price?: (model: string) => Price | null;
  /** For tests. Default: writeResults. */
  write?: (file: ResultsFile, raw: unknown) => string;
}

export interface SweepResult {
  rows: ResultRow[];
  path: string;
}

/** A count metric: the outcomes that pass `test`, of all outcomes. An outcome with an error is a miss. */
export function countHits<Item, Output>(
  name: string,
  outcomes: Outcome<Item, Output>[],
  test: (outcome: Outcome<Item, Output> & { output: Output }) => boolean
): Metric {
  const hits = outcomes.filter((outcome) => outcome.error === null && test(outcome as Outcome<Item, Output> & { output: Output }));
  return { name, hits: hits.length, n: outcomes.length };
}

/** The effort of a row for a call that takes no effort. */
export const NO_EFFORT = "n/a";

const roundMs = (ms: number | null) => (ms === null ? null : Math.round(ms));

function perCall(usage: Usage, price: Price | null, runs: number): number | null {
  if (runs === 0) return 0;
  if (usage.calls === 0) return 0;
  return price ? costUsd(usage, price) / runs : null;
}

/**
 * Runs every item (capped by EVAL_LIMIT) EVAL_REPEATS times for each config of the sweep, one config after
 * another, then writes the results file and the raw JSON.
 */
export async function runSweep<Item, Output>(spec: SweepSpec<Item, Output>): Promise<SweepResult> {
  const { settings } = spec;
  const items = settings.limit ? spec.items.slice(0, settings.limit) : spec.items;
  const price = spec.price ?? priceOf;
  const date = new Date().toISOString().slice(0, 10);
  const sha = gitSha();
  const rows: ResultRow[] = [];
  const rawConfigs: unknown[] = [];

  for (const config of sweepConfigs(settings)) {
    const recorder = new UsageRecorder();
    const judgeRecorder = new UsageRecorder();
    const client = recordingClient(recorder);
    const judge = createJudge({ model: settings.judgeModel, effort: settings.judgeEffort, client: recordingClient(judgeRecorder) });
    const runs = Array.from({ length: settings.repeats }, (_, repeat) => items.map((item) => ({ item, repeat }))).flat();

    const outcomes = await mapLimit(runs, settings.concurrency, async ({ item, repeat }) => {
      const started = performance.now();
      const context: RunContext = { config, repeat, client, fetch: recordingFetch(recorder), judge };
      try {
        const output = await spec.run(item, context);
        return { item, id: spec.id(item), repeat, latencyMs: performance.now() - started, output, error: null };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return { item, id: spec.id(item), repeat, latencyMs: performance.now() - started, output: null, error: message };
      }
    });

    const latencies = outcomes.filter((outcome) => outcome.error === null).map((outcome) => outcome.latencyMs);
    const judgeUsage = judgeRecorder.total();
    const row: ResultRow = {
      model: config.model,
      effort: settings.effortApplies ? (config.effort ?? null) : NO_EFFORT,
      n: outcomes.length,
      errors: outcomes.filter((outcome) => outcome.error !== null).length,
      metrics: spec.score(outcomes),
      latencyMs: { p50: roundMs(percentile(latencies, 50)), p95: roundMs(percentile(latencies, 95)) },
      costPerCallUsd: perCall(recorder.total(), price(config.model), outcomes.length),
      judgeCostPerCallUsd: judgeUsage.calls === 0 ? null : perCall(judgeUsage, price(settings.judgeModel), outcomes.length),
      date,
      gitSha: sha,
    };
    rows.push(row);
    rawConfigs.push({
      model: config.model,
      effort: config.effort ?? null,
      usage: recorder.total(),
      judgeUsage,
      row,
      outcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        repeat: outcome.repeat,
        latencyMs: Math.round(outcome.latencyMs),
        error: outcome.error,
        ...spec.raw?.(outcome),
      })),
    });
    console.info(
      `[${spec.task}] ${config.model} / ${row.effort ?? effortLabel(undefined)}: ` +
        row.metrics.map((metric) => `${metric.name} ${"hits" in metric ? `${metric.hits}/${metric.n}` : metric.value}`).join(", ") +
        `; errors ${row.errors}; cost/call ${row.costPerCallUsd === null ? "unknown" : `$${row.costPerCallUsd.toFixed(6)}`}`
    );
  }

  const raw = {
    task: spec.task,
    date,
    gitSha: sha,
    settings: { ...settings, efforts: settings.efforts.map((effort) => effort ?? null) },
    configs: rawConfigs,
  };
  const path = (spec.write ?? writeResults)({ task: spec.task, title: spec.title, notes: spec.notes, rows }, raw);
  return { rows, path };
}
