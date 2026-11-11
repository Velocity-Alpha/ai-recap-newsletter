import type { Metric } from "@/evals/lib/results";
import { countHits, type Outcome } from "@/evals/lib/sweep";

/** What one lead pick run gives. */
export interface LeadPickOutput {
  /** The board's proposed lead after the AI pick. A failed or off-shortlist pick leaves the scored lead. */
  boardLeadId: number | null;
  /** The story the model chose, or null when its answer was unusable. */
  pickedId: number | null;
}

/** The fields of a case scoring needs. */
export interface ScoredCase {
  ownerLeadId: number;
  scoredLeadId: number | null;
  shortlist: { id: number }[];
}

export function scoreLeadPick<C extends ScoredCase>(outcomes: Outcome<C, LeadPickOutput>[]): Metric[] {
  // The last two do not depend on the model: they are the same for every config.
  const all = outcomes.map((outcome) => ({ ...outcome, error: null, output: outcome.output }));
  return [
    countHits("AI lead = owner lead", outcomes, (outcome) => outcome.output.boardLeadId === outcome.item.ownerLeadId),
    countHits("AI pick usable", outcomes, (outcome) => outcome.output.pickedId !== null),
    countHits("Owner lead on shortlist", all, (outcome) => outcome.item.shortlist.some((entry) => entry.id === outcome.item.ownerLeadId)),
    countHits("Score-only lead = owner lead", all, (outcome) => outcome.item.scoredLeadId === outcome.item.ownerLeadId),
  ];
}
