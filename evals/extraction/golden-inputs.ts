// Writes the golden input of each built issue (evals/data/extraction/dataset.json) to
// evals/data/extraction/golden-inputs/<issueId>.json (gitignored: it holds the issue text), with its inputHash,
// and the rules a golden agent follows to _rules.md, built from the extraction prompt's own parts. Then reports
// which issues still need a golden value and what is wrong with the entries there are. golden-todo.md says how
// to use them.
//
// Usage: npm run eval:build -- evals/extraction/golden-inputs.ts  (after build-dataset.ts)

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { readDataset, readManifest } from "@/evals/extraction/dataset";
import { GOLDEN_INPUTS_DIR, GOLDEN_PATH, goldenInput, goldenInputFile, goldenProblems, goldenRules, type ExtractionGolden } from "@/evals/extraction/golden";
import { loadGolden, missingGolden } from "@/evals/lib/golden";

function main() {
  const items = readDataset();
  mkdirSync(GOLDEN_INPUTS_DIR, { recursive: true });
  for (const item of items) {
    const file = goldenInputFile(item);
    writeFileSync(join(GOLDEN_INPUTS_DIR, `${file.itemId}.json`), `${JSON.stringify(file, null, 2)}\n`);
  }
  writeFileSync(join(GOLDEN_INPUTS_DIR, "_rules.md"), goldenRules());
  console.info(`Wrote ${items.length} golden inputs and _rules.md to ${GOLDEN_INPUTS_DIR}.`);

  const golden = loadGolden<ExtractionGolden>(GOLDEN_PATH);
  const missing = missingGolden(golden, items.map((item) => ({ id: item.id, input: goldenInput(item) })));
  console.info(`${items.length - missing.length} of ${items.length} issues have a golden value.${missing.length ? ` To do: ${missing.join(", ")}` : ""}`);
  const problems = goldenProblems(golden, readManifest().map((issue) => issue.id), items);
  if (problems.length) console.info(`Problems:\n${problems.map((problem) => `- ${problem}`).join("\n")}`);
}

main();
