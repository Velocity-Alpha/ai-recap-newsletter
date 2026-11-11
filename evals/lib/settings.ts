import type { ServiceTier } from "@/evals/lib/usage";
import { isReasoningEffort, type ReasoningEffort } from "@/src/lib/reasoning-effort";

/**
 * An effort to run a call with. `undefined` sends no `reasoning` field, so the API's own default applies (the
 * `default` word in EVAL_EFFORTS). Only evals use it: every production call site sets its effort.
 */
export type EffortSetting = ReasoningEffort | undefined;

/** "Send no effort": a sweep entry that drops the call's `reasoning` field, so the API's own default applies. */
export const API_DEFAULT: EffortSetting = undefined;

/** One model and effort to run every item with. */
export interface EvalConfig {
  model: string;
  effort: EffortSetting;
}

export interface EvalSettings {
  model: string;
  /** `undefined` in the list is the API default (no `reasoning` field). */
  efforts: EffortSetting[];
  /** False for a call that takes no effort (the Decisions API): results show the effort as "n/a". */
  effortApplies: boolean;
  /** The call site's production effort: every other row is compared to its row. Null: no comparison. */
  baseline: ReasoningEffort | null;
  repeats: number;
  /** Run only the first N items, for a quick run. */
  limit: number | null;
  /** Item runs in flight at once, over all configs of the sweep. */
  concurrency: number;
  judgeModel: string;
  judgeEffort: EffortSetting;
  /** The tier of judge calls and shared work. The call under test is always on standard. */
  judgeTier: ServiceTier;
  /** Judge calls (and grades) in flight at once. */
  judgeConcurrency: number;
  /** Grade only the first N repeats of each item (EVAL_JUDGE_REPEATS). Null grades every repeat. */
  judgeRepeats: number | null;
}

export interface EvalDefaults {
  model: string;
  /** The eval's default sweep. `null` for a call that takes no effort (the sweep is over the model alone). */
  efforts: EffortSetting[] | null;
  /** The call site's production effort constant (for example SEARCH_EFFORT). Added to the sweep when missing. */
  baseline?: ReasoningEffort;
  repeats?: number;
  concurrency?: number;
  /** The eval's default for EVAL_JUDGE_REPEATS. */
  judgeRepeats?: number;
}

type Env = Record<string, string | undefined>;

/** The word for the API default in EVAL_EFFORTS and in results. */
const API_DEFAULT_WORD = "default";

export function effortLabel(effort: EffortSetting): string {
  return effort ?? "api default";
}

function parseEffort(word: string, name: string): EffortSetting {
  if (word === API_DEFAULT_WORD) return API_DEFAULT;
  if (isReasoningEffort(word)) return word;
  throw new Error(`${name}: "${word}" is not an effort. Use none, low, medium, high, xhigh, max or ${API_DEFAULT_WORD}.`);
}

const DEFAULT_CONCURRENCY = 24;
const DEFAULT_JUDGE = { model: "gpt-6.1-terra", effort: "medium" as const, tier: "flex" as const };

function parseTier(env: Env): ServiceTier {
  const raw = env.EVAL_JUDGE_TIER?.trim();
  if (!raw) return DEFAULT_JUDGE.tier;
  if (raw === "flex" || raw === "standard") return raw;
  throw new Error(`EVAL_JUDGE_TIER: "${raw}" is not a tier. Use flex or standard.`);
}

function positiveInteger(env: Env, name: string): number | null {
  const raw = env[name]?.trim();
  if (!raw) return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a whole number of 1 or more, not "${raw}".`);
  return value;
}

/** The run's settings: the eval's defaults, changed by the EVAL_* environment variables (evals/README.md). */
export function evalSettings(defaults: EvalDefaults, env: Env = process.env): EvalSettings {
  const effortsRaw = env.EVAL_EFFORTS?.trim();
  let efforts: EffortSetting[];
  if (defaults.efforts === null) {
    if (effortsRaw) throw new Error("This eval's model call takes no effort. Unset EVAL_EFFORTS; sweep EVAL_MODEL instead.");
    efforts = [API_DEFAULT];
  } else {
    efforts = effortsRaw
      ? effortsRaw.split(",").map((word) => parseEffort(word.trim(), "EVAL_EFFORTS"))
      : [...defaults.efforts];
  }
  const baseline = defaults.efforts === null ? null : (defaults.baseline ?? null);
  if (baseline !== null && !efforts.includes(baseline)) efforts = [baseline, ...efforts];
  const judgeEffortRaw = env.EVAL_JUDGE_EFFORT?.trim();
  return {
    model: env.EVAL_MODEL?.trim() || defaults.model,
    efforts,
    effortApplies: defaults.efforts !== null,
    baseline,
    repeats: positiveInteger(env, "EVAL_REPEATS") ?? defaults.repeats ?? 1,
    limit: positiveInteger(env, "EVAL_LIMIT"),
    concurrency: positiveInteger(env, "EVAL_CONCURRENCY") ?? defaults.concurrency ?? DEFAULT_CONCURRENCY,
    judgeModel: env.EVAL_JUDGE_MODEL?.trim() || DEFAULT_JUDGE.model,
    judgeEffort: judgeEffortRaw ? parseEffort(judgeEffortRaw, "EVAL_JUDGE_EFFORT") : DEFAULT_JUDGE.effort,
    judgeTier: parseTier(env),
    judgeConcurrency: positiveInteger(env, "EVAL_JUDGE_CONCURRENCY") ?? DEFAULT_CONCURRENCY,
    judgeRepeats: positiveInteger(env, "EVAL_JUDGE_REPEATS") ?? defaults.judgeRepeats ?? null,
  };
}

export function sweepConfigs(settings: EvalSettings): EvalConfig[] {
  return settings.efforts.map((effort) => ({ model: settings.model, effort }));
}
