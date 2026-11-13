/**
 * Adds the labels exported from the labeling page to the golden file `evals/section-scoring/golden.json` (#177).
 *
 *   npx vite-node --config evals/vitest.eval.config.ts evals/section-scoring/import-labels.ts -- <export.json>
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import path from "path";

import { loadGolden } from "@/evals/lib/golden";
import { addLabels, emptyGolden, type GoldenLabel, type Sets } from "@/evals/section-scoring/golden-labels";
import type { LabelExport } from "@/evals/section-scoring/labels";

const GOLDEN_FILE = path.resolve(__dirname, "golden.json");
const SETS_FILE = path.resolve(__dirname, "sets.json");

const file = process.argv.slice(2).find((arg) => arg !== "--");
if (!file) throw new Error("Give the exported labels file.");
const exported = JSON.parse(readFileSync(file, "utf8")) as LabelExport;
const sets = JSON.parse(readFileSync(SETS_FILE, "utf8")) as Sets;
const golden = existsSync(GOLDEN_FILE) ? loadGolden<GoldenLabel>(GOLDEN_FILE) : emptyGolden();
const updated = addLabels(golden, exported, sets);
writeFileSync(GOLDEN_FILE, `${JSON.stringify(updated, null, 2)}\n`);

const states: Record<string, number> = {};
for (const { label } of exported.labels) states[label.state] = (states[label.state] ?? 0) + 1;
console.log(`Added ${exported.labels.length} labels of ${exported.batch} (${JSON.stringify(states)}). Golden file: ${Object.keys(updated.entries).length} stories.`);
