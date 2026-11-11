import { DEFAULT_REASON_CODES, reasonCodesOf, type ReasonCodes } from "@/src/pipeline/feedback/default-reason-codes";
import { readSetting } from "@/src/pipeline/settings";

/**
 * The **reason codes** (GLOSSARY.md, #150): the one-tap reasons the board offers for an exclude, a lead change, and
 * a move. They live in the pipeline setting `feedback.reason_codes`, so a change is one database row and no deploy.
 * The commit stores the code as sent and does not check it against this list, because the list can change.
 */

export { DEFAULT_REASON_CODES, type ReasonCodes };

export const REASON_CODES_SETTING = "feedback.reason_codes";

/** The setting, with the default for a missing row or for each key that is not a list of strings. Never throws. */
export async function readReasonCodes(): Promise<ReasonCodes> {
  try {
    return reasonCodesOf(await readSetting(REASON_CODES_SETTING));
  } catch (error) {
    console.error(`[feedback] Could not read ${REASON_CODES_SETTING}: ${error instanceof Error ? error.message : String(error)}`);
    return DEFAULT_REASON_CODES;
  }
}
