// Writes the golden input of each story of evals/free-links/stories.json to
// evals/data/free-links/golden-inputs/<storyId>.json (gitignored), with its inputHash, and the rules a golden
// agent follows to _rules.md, built from the app's own words. golden-todo.md says how to use them.
//
// Usage: npm run eval:build -- evals/free-links/golden-inputs.ts
// DATABASE_URL (the Neon dev branch, read-only) adds the learned paywalled sites to the rules; without it, none.

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GOLDEN_INPUTS_DIR, goldenInputFile, goldenRules } from "@/evals/free-links/golden";
import { readStories } from "@/evals/free-links/stories";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import { isLearned } from "@/src/pipeline/free-links/paywall-sites";

async function main() {
  const rows = await readOnlyQuery<{ site: string; story_ids: number[]; ignored: boolean }>(
    "SELECT site, story_ids, ignored FROM newsletter.paywall_sites ORDER BY site"
  );
  const learned = (rows ?? []).filter((row) => isLearned({ storyIds: row.story_ids, ignored: row.ignored })).map((row) => row.site);
  mkdirSync(GOLDEN_INPUTS_DIR, { recursive: true });
  const stories = readStories();
  for (const story of stories) {
    const file = goldenInputFile(story);
    writeFileSync(join(GOLDEN_INPUTS_DIR, `${file.itemId}.json`), `${JSON.stringify(file, null, 2)}\n`);
  }
  writeFileSync(join(GOLDEN_INPUTS_DIR, "_rules.md"), goldenRules(learned));
  const learnedNote = rows === null ? "no DATABASE_URL, so no learned sites" : `${learned.length} learned sites`;
  console.info(`Wrote ${stories.length} golden inputs and _rules.md to ${GOLDEN_INPUTS_DIR} (${learnedNote}).`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
