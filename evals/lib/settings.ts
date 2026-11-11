import { isReasoningEffort, type EffortSetting } from "@/src/lib/reasoning-effort";

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
  repeats: number;
  /** Run only the first N items, for a quick run. */
  limit: number | null;
  /** Items in flight at once. */
  concurrency: number;
  judgeModel: string;
  judgeEffort: EffortSetting;
}

export interface EvalDefaults {
  model: string;
  /** The eval's default sweep. `null` for a call that takes no effort (the sweep is over the model alone). */
  efforts: EffortSetting[] | null;
  repeats?: number;
  concurrency?: number;
}

type Env = Record<string, string | undefined>;

/** The word for the API default in EVAL_EFFORTS and in results. */
const API_DEFAULT_WORD = "default";

export function effortLabel(effort: EffortSetting): string {
  return effort ?? "api default";
}

function parseEffort(word: string, name: string): EffortSetting {
  if (word === API_DEFAULT_WORD) return undefined;
  if (isReasoningEffort(word)) return word;
  throw new Error(`${name}: "${word}" is not an effort. Use none, low, medium, high, xhigh, max or ${API_DEFAULT_WORD}.`);
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
    efforts = [undefined];
  } else {
    efforts = effortsRaw
      ? effortsRaw.split(",").map((word) => parseEffort(word.trim(), "EVAL_EFFORTS"))
      : [...defaults.efforts];
  }
  const judgeEffortRaw = env.EVAL_JUDGE_EFFORT?.trim();
  return {
    model: env.EVAL_MODEL?.trim() || defaults.model,
    efforts,
    effortApplies: defaults.efforts !== null,
    repeats: positiveInteger(env, "EVAL_REPEATS") ?? defaults.repeats ?? 1,
    limit: positiveInteger(env, "EVAL_LIMIT"),
    concurrency: positiveInteger(env, "EVAL_CONCURRENCY") ?? defaults.concurrency ?? 4,
    judgeModel: env.EVAL_JUDGE_MODEL?.trim() || "gpt-6-sol",
    judgeEffort: judgeEffortRaw ? parseEffort(judgeEffortRaw, "EVAL_JUDGE_EFFORT") : "high",
  };
}

export function sweepConfigs(settings: EvalSettings): EvalConfig[] {
  return settings.efforts.map((effort) => ({ model: settings.model, effort }));
}
