import type { Metric } from "@/evals/lib/results";
import { countHits, type Outcome } from "@/evals/lib/sweep";
import { pairLevel, type PairLevel } from "@/src/pipeline/repeats/repeat-rules";

import type { PairLabel } from "@/evals/repeats/pairs";

/** The judge's answer for one pair, or `refused` when the API gave no probability for one of the questions. */
export type PairOutput = { same: number; news: number } | { refused: true };

/** The level of an answer, with the thresholds of the repeat check (repeat-rules.ts). A refusal has no level. */
export function levelOf(output: PairOutput): PairLevel | null {
  return "refused" in output ? null : pairLevel(output);
}

/** The measures of src/pipeline/repeats/__fixtures__/README.md. An error is a miss (also for different -> sure). */
export function scoreRepeats<C extends { label: PairLabel }>(outcomes: Outcome<C, PairOutput>[]): Metric[] {
  const withLabel = (label: PairLabel) => outcomes.filter((outcome) => outcome.item.label === label);
  return [
    countHits("same -> sure", withLabel("same"), (outcome) => levelOf(outcome.output) === "sure"),
    countHits("same -> sure or similar", withLabel("same"), (outcome) => levelOf(outcome.output) !== null),
    countHits("different -> sure", withLabel("different"), (outcome) => levelOf(outcome.output) === "sure"),
    countHits("follow_up -> sure", withLabel("follow_up"), (outcome) => levelOf(outcome.output) === "sure"),
    countHits("refused", outcomes, (outcome) => "refused" in outcome.output),
  ];
}
