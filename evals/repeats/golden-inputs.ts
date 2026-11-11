// Writes the golden input of each new pair of evals/repeats/new-pairs.json to
// evals/data/repeats/golden-inputs/<newer>-<older>.json (gitignored), with its inputHash, and the labelling rules
// to _rules.md, built from evals/repeats/labels.ts. golden-todo.md says how to use them.
//
// Usage: npm run eval:build -- evals/repeats/golden-inputs.ts

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { GOLDEN_INPUTS_DIR, goldenInputFile, goldenRules } from "@/evals/repeats/golden";
import { newPairItems } from "@/evals/repeats/pairs";

function main() {
  mkdirSync(GOLDEN_INPUTS_DIR, { recursive: true });
  const items = newPairItems();
  for (const item of items) {
    writeFileSync(join(GOLDEN_INPUTS_DIR, `${item.id}.json`), `${JSON.stringify(goldenInputFile(item), null, 2)}\n`);
  }
  writeFileSync(join(GOLDEN_INPUTS_DIR, "_rules.md"), goldenRules());
  console.info(`Wrote ${items.length} golden inputs and _rules.md to ${GOLDEN_INPUTS_DIR}.`);
}

main();
