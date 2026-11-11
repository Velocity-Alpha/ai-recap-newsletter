/**
 * The reasoning effort of an OpenAI Responses API call. gpt-6-luna and gpt-6-sol accept these values, and use
 * `medium` when a request sends none: https://developers.openai.com/api/docs/models/gpt-6-luna
 * Lowest first, so an eval can sweep them in order.
 */
export const REASONING_EFFORTS = ["none", "low", "medium", "high", "xhigh", "max"] as const;
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number];

/** The effort a call sends. `undefined` sends no `reasoning` field, so the API default applies. */
export type EffortSetting = ReasoningEffort | undefined;

/** For a call that sends no effort today: the API default. */
export const API_DEFAULT_EFFORT: EffortSetting = undefined;

export function isReasoningEffort(value: string): value is ReasoningEffort {
  return (REASONING_EFFORTS as readonly string[]).includes(value);
}

/**
 * The effort an override asks for, else the call's default. An `effort` key that is present but `undefined`
 * asks for the API default, so an eval can compare a call's set effort with no effort at all.
 */
export function effortOrDefault(options: { effort?: EffortSetting }, defaultEffort: EffortSetting): EffortSetting {
  return "effort" in options ? options.effort : defaultEffort;
}

/** The request field for an effort: `{ reasoning: { effort } }`, or nothing for the API default. */
export function reasoningField(effort: EffortSetting): { reasoning?: { effort: ReasoningEffort } } {
  return effort === undefined ? {} : { reasoning: { effort } };
}
