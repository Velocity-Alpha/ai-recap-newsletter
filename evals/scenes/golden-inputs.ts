// Writes the golden input of each scene issue to evals/data/scenes/golden-inputs/<itemId>.json (gitignored), for the
// Claude Opus agents that make evals/scenes/golden.json (evals/scenes/golden-todo.md). Each file holds the item id,
// the inputHash its golden entry must carry, and the input: the issue's subject line and numbered top stories.
//
// Usage: npm run eval:build -- evals/scenes/golden-inputs.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { hashInput } from "@/evals/lib/golden";
import { SCENE_GOLDEN_INPUTS_DIR, sceneGoldenInput, sceneItemId } from "@/evals/scenes/golden";
import { readSceneIssues } from "@/evals/scenes/issues";

mkdirSync(SCENE_GOLDEN_INPUTS_DIR, { recursive: true });
const { issues } = readSceneIssues();
for (const issue of issues) {
  const input = sceneGoldenInput(issue);
  const file = {
    itemId: sceneItemId(issue),
    inputHash: hashInput(input),
    input,
    // For reading only, not part of the hash: the 1-based number lead_story refers to.
    numberedHeadlines: input.topStories.map((story, index) => `${index + 1}. ${story.headline}`),
  };
  writeFileSync(join(SCENE_GOLDEN_INPUTS_DIR, `${file.itemId}.json`), `${JSON.stringify(file, null, 2)}\n`);
}
console.info(`Wrote ${issues.length} golden inputs to ${SCENE_GOLDEN_INPUTS_DIR}.`);
