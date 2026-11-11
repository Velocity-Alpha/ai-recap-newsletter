import { readSetting } from "@/src/pipeline/settings";

/**
 * The **reason codes** (GLOSSARY.md, #150): the one-tap reasons the board offers for an exclude, a lead change, and
 * a move. They live in the pipeline setting `feedback.reason_codes`, so a change is one database row and no deploy.
 * The commit stores the code as sent and does not check it against this list, because the list can change.
 */

export const REASON_CODES_SETTING = "feedback.reason_codes";

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

/** The setting, with the default for a missing row or for each key that is not a list of strings. Never throws. */
export async function readReasonCodes(): Promise<ReasonCodes> {
  let value: unknown;
  try {
    value = await readSetting(REASON_CODES_SETTING);
  } catch (error) {
    console.error(`[feedback] Could not read ${REASON_CODES_SETTING}: ${error instanceof Error ? error.message : String(error)}`);
    return DEFAULT_REASON_CODES;
  }
  const setting = value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
  const pick = (key: keyof ReasonCodes) => {
    const codes = setting[key];
    return isStringList(codes) ? codes : DEFAULT_REASON_CODES[key];
  };
  return { exclude: pick("exclude"), lead: pick("lead"), move: pick("move") };
}
