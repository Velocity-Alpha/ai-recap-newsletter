/**
 * The starting **reason codes** (GLOSSARY.md, #150) and their shape. No database access here, so the board can
 * import it; `readReasonCodes` (reason-codes.ts) reads the setting.
 */

export interface ReasonCodes {
  exclude: string[];
  lead: string[];
  move: string[];
}

export const DEFAULT_REASON_CODES: ReasonCodes = {
  exclude: ["repeat", "not news", "too niche", "weak source", "promo", "low quality"],
  lead: ["bigger story", "more reach", "less doom"],
  move: ["wrong section"],
};

function isStringList(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/** The codes of a setting value, with the default for each key that is not a list of strings. */
export function reasonCodesOf(value: unknown): ReasonCodes {
  const setting = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof ReasonCodes) => {
    const codes = setting[key];
    return isStringList(codes) ? codes : DEFAULT_REASON_CODES[key];
  };
  return { exclude: pick("exclude"), lead: pick("lead"), move: pick("move") };
}
