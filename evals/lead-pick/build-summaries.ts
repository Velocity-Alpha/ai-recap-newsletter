// Builds evals/lead-pick/summaries.json from the Neon dev branch (read-only): our own summary of each story on the
// archived boards (src/features/newsletter/__fixtures__/archived-boards.json has headlines only). Commit the file:
// the lead pick eval reads it, so a reset of the dev branch does not change its input.
//
// Usage: npm run eval:build -- evals/lead-pick/build-summaries.ts
// Needs DATABASE_URL (the Neon dev branch).

import { writeFileSync } from "node:fs";

import { boardStoryIds } from "@/evals/lead-pick/boards";
import { BOARD_SUMMARIES_PATH, type BoardSummariesFile } from "@/evals/lead-pick/summaries";
import { readOnlyQuery } from "@/evals/lib/dev-db";

async function main() {
  const ids = boardStoryIds();
  const rows = await readOnlyQuery<{ id: number; summary: string | null }>(
    "SELECT id, summary FROM newsletter.stories WHERE id = ANY($1::int[]) ORDER BY id",
    [ids]
  );
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  const summaries = Object.fromEntries(rows.filter((row) => row.summary?.trim()).map((row) => [String(row.id), row.summary!.trim()]));
  const file: BoardSummariesFile = {
    note:
      "Our own summaries of the stories on the archived boards, read from newsletter.stories on the Neon dev branch by " +
      `evals/lead-pick/build-summaries.ts: ${Object.keys(summaries).length} of the ${ids.length} board stories have one.`,
    summaries,
  };
  writeFileSync(BOARD_SUMMARIES_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.info(`Wrote ${Object.keys(summaries).length} summaries to ${BOARD_SUMMARIES_PATH}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
