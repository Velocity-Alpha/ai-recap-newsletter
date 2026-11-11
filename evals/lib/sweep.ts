import type OpenAI from "openai";

import { createJudge, type Judge } from "@/evals/lib/judge";
import { gitSha, writeResults, type Metric, type ResultRow, type ResultsFile } from "@/evals/lib/results";
import { effortLabel, sweepConfigs, type EvalConfig, type EvalSettings } from "@/evals/lib/settings";
import { createLimit, mapLimit } from "@/evals/lib/concurrency";
import { pairedBootstrap, percentile } from "@/evals/lib/stats";
import {
  addUsage,
  costUsd,
  NO_USAGE,
  priceOf,
  recordingClient,
  recordingFetch,
  UsageRecorder,
  type Price,
  type RecordingClient,
  type ResponsesApi,
  type Usage,
} from "@/evals/lib/usage";

/** What `run` gets for one item run. Pass `client` or `fetch` to the call site so its usage and time are counted. */
export interface RunContext {
  config: EvalConfig;
  /** 0 to EVAL_REPEATS - 1. */
  repeat: number;
  /**
   * A Responses API client that records this run's usage, web searches and call times. It is always on the standard
   * tier, as in production; it waits out rate limits, and that wait is not in the latency.
   */
  client: RecordingClient;
  /** A fetch that records this run's usage and call times (for the Decisions API). */
  fetch: typeof fetch;
  /** The Responses API answers of this run so far, for what the call site does not return (raw text, tool calls). */
  responses: () => OpenAI.Responses.Response[];
}

/**
 * Work done once for the whole sweep, by key: every config that asks for the same key gets the same promise. Use it
 * for expensive work that does not depend on the config (reading a link, a verdict on a link). Its cost is shown
 * as one line under the table, not in the per-call costs.
 */
export type Shared = <T>(key: string, work: (tools: { judge: Judge }) => Promise<T>) => Promise<T>;

/** What `grade` gets. Grading is not timed, and the judge's cost is shown apart. */
export interface GradeContext {
  config: EvalConfig;
  repeat: number;
  /** The judge (EVAL_JUDGE_MODEL, on EVAL_JUDGE_TIER). Its cost goes to this config's judge cost. */
  judge: Judge;
  shared: Shared;
}

/** "none": the eval has no grade step, or the run failed. "skipped": the repeat is past EVAL_JUDGE_REPEATS. */
export type GradeStatus = "graded" | "failed" | "skipped" | "none";

/** One item run. `output` is null when `run` threw; `grade` is null unless `gradeStatus` is "graded". */
export interface Outcome<Item, Output, Grade = never> {
  item: Item;
  id: string;
  repeat: number;
  /** The time of `run`, less its waits on rate limits: the model calls, not grading. */
  latencyMs: number;
  output: Output | null;
  error: string | null;
  /** The usage of this run's model calls. */
  usage: Usage;
  /** Milliseconds of each model call of this run. */
  callMs: number[];
  grade: Grade | null;
  gradeStatus: GradeStatus;
  gradeError: string | null;
}

/** The outcomes of one config, for `afterSweep`. */
export interface ConfigOutcomes<Item, Output, Grade> {
  config: EvalConfig;
  outcomes: Outcome<Item, Output, Grade>[];
}

export interface AfterSweepContext {
  /** A judge whose cost goes to that config's judge cost. */
  judgeFor: (config: EvalConfig) => Judge;
  shared: Shared;
}

export interface SweepSpec<Item, Output, Grade = never> {
  /** The folder name under evals/, and the name of the results file. */
  task: string;
  title: string;
  /** Lines for the results file: what is measured, ground truth, data source. No third-party text. */
  notes: string[];
  settings: EvalSettings;
  items: Item[];
  id: (item: Item) => string;
  /** Calls the real call site for one item, with `context.config`'s model and effort. The only part that is timed. */
  run: (item: Item, context: RunContext) => Promise<Output>;
  /** Grades a run's output: the judge, reads, link checks. Not timed. Only the first EVAL_JUDGE_REPEATS repeats. */
  grade?: (item: Item, output: Output, context: GradeContext) => Promise<Grade>;
  /** The metrics of one config, from its outcomes (errors included). Called for all of them and for each repeat. Pure. */
  score: (outcomes: Outcome<Item, Output, Grade>[]) => Metric[];
  /**
   * Runs once after every config ran, with all their outcomes, for metrics that compare configs (a pairwise judge).
   * Returns extra metrics, and raw data, for each config, in the order given.
   */
  afterSweep?: (
    configs: ConfigOutcomes<Item, Output, Grade>[],
    context: AfterSweepContext
  ) => Promise<Array<{ metrics: Metric[]; raw?: unknown }>>;
  /** The metric columns of the results table, in order. Default: all. */
  columns?: string[];
  /** Extra fields for each outcome in the raw JSON (evals/out/, gitignored). Ids, numbers and our headlines. */
  raw?: (outcome: Outcome<Item, Output, Grade>) => Record<string, unknown>;
  /** The price of a model. Default: PRICES in usage.ts. */
  price?: (model: string) => Price | null;
  /** For tests: the Responses API of the run and judge clients. Default: the OpenAI client. */
  api?: () => ResponsesApi;
  /** For tests. Default: writeResults. */
  write?: (file: ResultsFile, raw: unknown) => string;
}

export interface SweepResult {
  rows: ResultRow[];
  path: string;
}

/** A count metric: the outcomes that pass `test`, of all outcomes. An outcome with an error is a miss. */
export function countHits<Item, Output, Grade>(
  name: string,
  outcomes: Outcome<Item, Output, Grade>[],
  test: (outcome: Outcome<Item, Output, Grade> & { output: Output }) => boolean
): Metric {
  const hits = outcomes.filter((outcome) => outcome.error === null && test(outcome as Outcome<Item, Output, Grade> & { output: Output }));
  return { name, hits: hits.length, n: outcomes.length };
}

/** The outcomes the judge graded, with their output and grade. */
export function gradedOutcomes<Item, Output, Grade>(
  outcomes: Outcome<Item, Output, Grade>[]
): Array<Outcome<Item, Output, Grade> & { output: Output; grade: Grade }> {
  return outcomes.filter(
    (outcome): outcome is Outcome<Item, Output, Grade> & { output: Output; grade: Grade } =>
      outcome.gradeStatus === "graded" && outcome.output !== null && outcome.grade !== null
  );
}

/** A count metric over the graded outcomes only: runs the judge did not grade are not in `n`. */
export function countGraded<Item, Output, Grade>(
  name: string,
  outcomes: Outcome<Item, Output, Grade>[],
  test: (outcome: Outcome<Item, Output, Grade> & { output: Output; grade: Grade }) => boolean
): Metric {
  const graded = gradedOutcomes(outcomes);
  return { name, hits: graded.filter(test).length, n: graded.length };
}

/** The effort of a row for a call that takes no effort. */
export const NO_EFFORT = "n/a";

/**
 * Adds to each count of `metrics` its difference against the baseline's count of the same name, with a 95% paired
 * bootstrap interval that resamples items. `perItem[i]` and `baselinePerItem[i]` are the scores of item i alone (all
 * its repeats). A count whose per-item scores do not add up to its total, on either side, is left as it is.
 */
export function compareToBaseline(
  metrics: Metric[],
  perItem: Metric[][],
  baselineTotal: Metric[],
  baselinePerItem: Metric[][]
): Metric[] {
  type Count = { hits: number; n: number };
  const countOf = (list: Metric[], name: string): Count | null => {
    const found = list.find((entry) => entry.name === name);
    return found && "hits" in found ? { hits: found.hits, n: found.n } : null;
  };
  const addsUp = (total: Count, parts: Array<Count | null>) =>
    parts.every((part) => part !== null) &&
    parts.reduce((sum, part) => sum + part!.hits, 0) === total.hits &&
    parts.reduce((sum, part) => sum + part!.n, 0) === total.n;
  return metrics.map((metric) => {
    if (!("hits" in metric)) return metric;
    const base = countOf(baselineTotal, metric.name);
    if (!base || perItem.length !== baselinePerItem.length) return metric;
    const own = perItem.map((list) => countOf(list, metric.name));
    const theirs = baselinePerItem.map((list) => countOf(list, metric.name));
    if (!addsUp(metric, own) || !addsUp(base, theirs)) return metric;
    const vsBaseline = pairedBootstrap(own.map((other, index) => ({ baseline: theirs[index]!, other: other! })));
    return vsBaseline ? { ...metric, vsBaseline } : metric;
  });
}

/**
 * Adds to each metric the lowest and highest of its per-repeat values (`perRepeat[r]` is the score of repeat r).
 * Counts with no runs in a repeat and numbers that are not finite are left out; `valueRepeats` limits the repeats a
 * number comes from (the graded ones). A spread needs two or more repeats.
 */
export function withSpread(total: Metric[], perRepeat: Metric[][], valueRepeats: number = perRepeat.length): Metric[] {
  return total.map((metric) => {
    const values = perRepeat.flatMap((metrics, repeat) => {
      const same = metrics.find((entry) => entry.name === metric.name);
      if (!same) return [];
      if ("hits" in same) return same.n > 0 ? [same.hits / same.n] : [];
      return repeat < valueRepeats && Number.isFinite(same.value) ? [same.value] : [];
    });
    if (values.length < 2) return metric;
    return { ...metric, spread: { min: Math.min(...values), max: Math.max(...values) } };
  });
}

const roundMs = (ms: number | null) => (ms === null ? null : Math.round(ms));
const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

function perCall(usage: Usage, price: Price | null, runs: number): number | null {
  if (runs === 0 || usage.calls === 0) return 0;
  return price ? costUsd(usage, price) / runs : null;
}

/**
 * Runs every item (capped by EVAL_LIMIT) EVAL_REPEATS times for each config of the sweep, all configs at the same
 * time with at most EVAL_CONCURRENCY runs in flight; grades each run (at most EVAL_JUDGE_CONCURRENCY grades and
 * judge calls in flight); runs `afterSweep`; compares each row to the baseline row; then writes the results file
 * and the raw JSON. Outcomes keep the sweep's order, whatever order the runs finish in.
 */
export async function runSweep<Item, Output, Grade = never>(spec: SweepSpec<Item, Output, Grade>): Promise<SweepResult> {
  const { settings } = spec;
  const items = settings.limit ? spec.items.slice(0, settings.limit) : spec.items;
  const price = spec.price ?? priceOf;
  const date = new Date().toISOString().slice(0, 10);
  const sha = gitSha();
  const judgeRepeats = Math.min(settings.repeats, settings.judgeRepeats ?? settings.repeats);
  const judgeCalls = createLimit(settings.judgeConcurrency);
  const grades = createLimit(settings.judgeConcurrency);
  const makeJudge = (recorder: UsageRecorder): Judge => {
    const judge = createJudge({
      model: settings.judgeModel,
      effort: settings.judgeEffort,
      client: recordingClient(recorder, { tier: settings.judgeTier, api: spec.api }),
    });
    return (request) => judgeCalls(() => judge(request));
  };

  const sharedRecorder = new UsageRecorder();
  const sharedJudge = makeJudge(sharedRecorder);
  const sharedWork = new Map<string, Promise<unknown>>();
  const shared: Shared = <T>(key: string, work: (tools: { judge: Judge }) => Promise<T>) => {
    if (!sharedWork.has(key)) sharedWork.set(key, work({ judge: sharedJudge }));
    return sharedWork.get(key) as Promise<T>;
  };

  const configs = sweepConfigs(settings);
  const judgeRecorders = configs.map(() => new UsageRecorder());
  const judges = judgeRecorders.map(makeJudge);
  // Repeat, then item, then config: every config starts at once, and each config's runs stay in that order.
  const runs = Array.from({ length: settings.repeats }, (_, repeat) =>
    items.flatMap((item) => configs.map((config, configIndex) => ({ config, configIndex, item, repeat })))
  ).flat();

  async function gradeOutcome(outcome: Outcome<Item, Output, Grade>, config: EvalConfig, judge: Judge) {
    try {
      outcome.grade = await spec.grade!(outcome.item, outcome.output as Output, { config, repeat: outcome.repeat, judge, shared });
      outcome.gradeStatus = "graded";
    } catch (thrown) {
      outcome.gradeStatus = "failed";
      outcome.gradeError = errorMessage(thrown);
      console.warn(`[${spec.task}] ${outcome.id}: grading failed: ${outcome.gradeError}`);
    }
  }

  const grading: Promise<void>[] = [];
  const outcomes = await mapLimit(runs, settings.concurrency, async ({ config, configIndex, item, repeat }): Promise<Outcome<Item, Output, Grade>> => {
    const recorder = new UsageRecorder();
    const context: RunContext = {
      config,
      repeat,
      // The call under test is always on the standard tier: its latency is a metric and its timeouts mirror production.
      client: recordingClient(recorder, { tier: "standard", sendNoEffort: config.effort === undefined, api: spec.api }),
      fetch: recordingFetch(recorder),
      responses: () => [...recorder.responses],
    };
    const started = performance.now();
    let output: Output | null = null;
    let error: string | null = null;
    try {
      output = await spec.run(item, context);
    } catch (thrown) {
      error = errorMessage(thrown);
    }
    const outcome: Outcome<Item, Output, Grade> = {
      item,
      id: spec.id(item),
      repeat,
      latencyMs: Math.max(0, performance.now() - started - recorder.waitMs),
      output,
      error,
      usage: recorder.total(),
      callMs: [...recorder.callMs],
      grade: null,
      gradeStatus: "none",
      gradeError: null,
    };
    if (spec.grade && error === null) {
      if (repeat >= judgeRepeats) outcome.gradeStatus = "skipped";
      // Grading does not hold a run's slot: the next run starts while this one is graded.
      else grading.push(grades(() => gradeOutcome(outcome, config, judges[configIndex])));
    }
    return outcome;
  });
  await Promise.all(grading);

  const swept: ConfigOutcomes<Item, Output, Grade>[] = configs.map((config, index) => ({
    config,
    outcomes: outcomes.filter((_, run) => runs[run].configIndex === index),
  }));
  for (const { config, outcomes: done } of swept) {
    console.info(`[${spec.task}] ${config.model} / ${effortLabel(config.effort)}: ${done.length} runs done`);
  }

  const after = spec.afterSweep
    ? await spec.afterSweep(swept, {
        judgeFor: (config) => makeJudge(judgeRecorders[configs.indexOf(config)]),
        shared,
      })
    : [];

  const baselineIndex = settings.baseline === null ? -1 : configs.findIndex((config) => config.effort === settings.baseline);
  const scorePerItem = (done: Outcome<Item, Output, Grade>[]) => items.map((item) => spec.score(done.filter((outcome) => outcome.item === item)));
  const baseline =
    baselineIndex === -1
      ? null
      : { total: spec.score(swept[baselineIndex].outcomes), perItem: scorePerItem(swept[baselineIndex].outcomes) };

  const sharedUsage = sharedRecorder.total();
  const sharedCostUsd = sharedUsage.calls === 0 ? undefined : (perCall(sharedUsage, price(settings.judgeModel), 1) ?? undefined);
  const rows: ResultRow[] = [];
  const rawConfigs: unknown[] = [];

  for (const [index, { config, outcomes }] of swept.entries()) {
    const usage = outcomes.reduce((sum, outcome) => addUsage(sum, outcome.usage), NO_USAGE);
    const judgeUsage = judgeRecorders[index].total();
    const latencies = outcomes.filter((outcome) => outcome.error === null).map((outcome) => outcome.latencyMs);
    const perRepeat = Array.from({ length: settings.repeats }, (_, repeat) => spec.score(outcomes.filter((outcome) => outcome.repeat === repeat)));
    const tried = outcomes.filter((outcome) => outcome.gradeStatus === "graded" || outcome.gradeStatus === "failed");
    const isBaseline = index === baselineIndex;
    const spread = withSpread(spec.score(outcomes), perRepeat, spec.grade ? judgeRepeats : settings.repeats);
    const metrics = baseline && !isBaseline ? compareToBaseline(spread, scorePerItem(outcomes), baseline.total, baseline.perItem) : spread;
    const row: ResultRow = {
      model: config.model,
      effort: settings.effortApplies ? (config.effort ?? null) : NO_EFFORT,
      ...(isBaseline ? { baseline: true } : {}),
      n: outcomes.length,
      errors: outcomes.filter((outcome) => outcome.error !== null).length,
      metrics: [...metrics, ...(after[index]?.metrics ?? [])],
      latencyMs: { p50: roundMs(percentile(latencies, 50)), p95: roundMs(percentile(latencies, 95)) },
      costPerCallUsd: perCall(usage, price(config.model), outcomes.length),
      judgeCostPerCallUsd: judgeUsage.calls === 0 ? null : perCall(judgeUsage, price(settings.judgeModel), outcomes.length),
      ...(judgeUsage.calls === 0 ? {} : { judge: `${settings.judgeModel} / ${effortLabel(settings.judgeEffort)}` }),
      ...(usage.webSearches > 0 ? { webSearchesPerCall: usage.webSearches / outcomes.length } : {}),
      ...(spec.grade ? { graded: { hits: tried.filter((outcome) => outcome.gradeStatus === "graded").length, n: tried.length } } : {}),
      ...(sharedCostUsd === undefined ? {} : { sharedCostUsd }),
      date,
      gitSha: sha,
    };
    rows.push(row);
    rawConfigs.push({
      model: config.model,
      effort: config.effort ?? null,
      usage,
      judgeUsage,
      row,
      afterSweep: after[index]?.raw,
      outcomes: outcomes.map((outcome) => ({
        id: outcome.id,
        repeat: outcome.repeat,
        latencyMs: Math.round(outcome.latencyMs),
        callMs: outcome.callMs,
        usage: outcome.usage,
        error: outcome.error,
        gradeStatus: outcome.gradeStatus,
        gradeError: outcome.gradeError,
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
    sharedUsage,
    configs: rawConfigs,
  };
  const file: ResultsFile = { task: spec.task, title: spec.title, notes: spec.notes, ...(spec.columns ? { columns: spec.columns } : {}), rows };
  const path = (spec.write ?? writeResults)(file, raw);
  return { rows, path };
}
