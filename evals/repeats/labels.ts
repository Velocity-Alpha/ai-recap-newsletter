import type { PairLabel } from "@/evals/repeats/pairs";

/**
 * The labelling rules of the repeat check's test set, word for word from src/pipeline/repeats/__fixtures__/README.md
 * ("Labelling rules"): the existing labels were made with them, so the golden labels of new pairs use them too.
 * labels.test.ts fails when the README's copy and this one differ. The Decisions API's own questions
 * (decisions.ts) are what the eval tests, so they are not the rules for the labels.
 */
export const PAIR_LABEL_RULES: Record<PairLabel, string> = {
  same:
    "both report the same underlying development (event, announcement, release, filing, funding round, paper, " +
    "ruling, product launch). A reader of one learns nothing important from the other. Source, wording, and level " +
    "of detail do not matter. A one-line product listing and a news story about that launch are `same`.",
  follow_up:
    "same specific story line, and the later one reports something materially new (a next step, a result, a " +
    "ruling, changed numbers, a response, a reversal).",
  different: "everything else, including two releases of one product, or two papers on one subject.",
};

export const PAIR_LABELS = Object.keys(PAIR_LABEL_RULES) as PairLabel[];

/** The rules as the README's list: "- `same`: ...". */
export function labelRulesList(): string {
  return PAIR_LABELS.map((label) => `- \`${label}\`: ${PAIR_LABEL_RULES[label]}`).join("\n");
}
