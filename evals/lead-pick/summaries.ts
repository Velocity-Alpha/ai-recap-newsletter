import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Our own summaries of the archived boards' stories, frozen in evals/lead-pick/summaries.json so that a reset of the
 * Neon dev branch does not change the lead pick's input. archived-boards.json has headlines only.
 * evals/lead-pick/build-summaries.ts writes the file (`npm run eval:build`).
 */

export const BOARD_SUMMARIES_PATH = join("evals", "lead-pick", "summaries.json");

export interface BoardSummariesFile {
  note: string;
  /** Story id to summary. A board story with no summary on the dev branch is left out. */
  summaries: Record<string, string>;
}

export function readBoardSummaries(path = BOARD_SUMMARIES_PATH): Map<number, string> {
  const file = JSON.parse(readFileSync(path, "utf8")) as BoardSummariesFile;
  return new Map(Object.entries(file.summaries).map(([id, summary]) => [Number(id), summary]));
}
