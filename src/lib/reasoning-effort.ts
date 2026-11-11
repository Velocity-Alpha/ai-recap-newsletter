/**
 * The reasoning effort of an OpenAI Responses API call. gpt-6-luna and gpt-6-sol accept these values
 * (https://developers.openai.com/api/docs/models/gpt-6-luna). Lowest first, so an eval can sweep them in order.
 * Every call site sets its effort explicitly.
 */
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/** The model and effort of a call site: its own constants. */
export interface ModelChoice {
  model: string;
  effort: ReasoningEffort;
}

/** What an eval may change at a call site. Production passes neither, so the call site's constants apply. */
export type ModelOverrides = Partial<ModelChoice>;

/** The `model` and `reasoning` fields of a request: the overrides, else the call site's constants. */
export function modelFields(overrides: ModelOverrides, defaults: ModelChoice): { model: string; reasoning: { effort: ReasoningEffort } } {
  return { model: overrides.model ?? defaults.model, reasoning: { effort: overrides.effort ?? defaults.effort } };
}
