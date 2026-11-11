import { join } from "node:path";

import { hashInput, type Golden } from "@/evals/lib/golden";
import { labelRulesList, PAIR_LABELS } from "@/evals/repeats/labels";
import { goldenPairInput, type NewPairItem, type PairGolden } from "@/evals/repeats/pairs";

/**
 * The golden labels of the new pairs (new-pairs.json): Claude Opus's label and confidence for each, by the
 * fixture's labelling rules (labels.ts). Story ids, labels and one short reason of our own: committed.
 */

export const GOLDEN_PATH = join("evals", "repeats", "golden.json");
export const GOLDEN_INPUTS_DIR = join("evals", "data", "repeats", "golden-inputs");
export const CONFIDENCES = ["high", "medium", "low"] as const;

/** The rules file a golden agent reads first (golden-inputs/_rules.md). */
export function goldenRules(): string {
  return [
    "# Rules for a repeat-check golden label",
    "",
    "Built by evals/repeats/golden-inputs.ts from evals/repeats/labels.ts, the labelling rules of",
    "src/pipeline/repeats/__fixtures__/README.md. Do not change them here.",
    "",
    "Story A is `newer`, Story B is `older`. The label is one of:",
    "",
    labelRulesList(),
    "",
    `Confidence is one of: ${CONFIDENCES.join(", ")}.`,
    "",
  ].join("\n");
}

export interface GoldenInputFile {
  itemId: string;
  /** hashInput(input): copy it to the entry's `inputHash`. */
  inputHash: string;
  input: ReturnType<typeof goldenPairInput>;
}

export function goldenInputFile(item: NewPairItem): GoldenInputFile {
  const input = goldenPairInput(item);
  return { itemId: item.id, inputHash: hashInput(input), input };
}

/** What is wrong with the golden entries: an unknown pair, a stale hash, or a value of the wrong shape. */
export function goldenProblems(golden: Golden<PairGolden>, items: NewPairItem[]): string[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  return Object.entries(golden.entries).flatMap(([id, entry]) => {
    const item = byId.get(id);
    if (!item) return [`${id}: not a new pair`];
    const problems: string[] = [];
    if (entry.inputHash !== hashInput(goldenPairInput(item))) problems.push(`${id}: inputHash is not that of its golden input`);
    if (!PAIR_LABELS.includes(entry.value?.label)) problems.push(`${id}: label must be one of ${PAIR_LABELS.join(", ")}`);
    if (!(CONFIDENCES as readonly string[]).includes(entry.value?.confidence)) problems.push(`${id}: confidence must be one of ${CONFIDENCES.join(", ")}`);
    if (typeof entry.value?.why !== "string" || !entry.value.why.trim()) problems.push(`${id}: why must be a short sentence`);
    return problems;
  });
}
