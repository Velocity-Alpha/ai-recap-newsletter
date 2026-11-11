import { describe, expect, it } from "vitest";

import { scoreLeadPick, type LeadPickOutput } from "@/evals/lead-pick/score";
import type { Metric } from "@/evals/lib/results";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";

const CASE = { ownerLeadId: 7, scoredLeadId: 9, shortlist: [{ id: 9 }, { id: 7 }] };
const outcome = (output: LeadPickOutput | null, item = CASE): Outcome<typeof CASE, LeadPickOutput> =>
  outcomeOf({ item, id: "2026-10-22", output, error: output ? null : "network" });

const metric = (name: string): Metric | undefined =>
  scoreLeadPick([
    outcome({ boardLeadId: 7, pickedId: 7 }),
    outcome({ boardLeadId: 9, pickedId: null }),
    outcome(null),
    outcome({ boardLeadId: 9, pickedId: 9 }, { ownerLeadId: 9, scoredLeadId: 9, shortlist: [{ id: 9 }] }),
  ]).find((entry) => entry.name === name);

describe("scoreLeadPick", () => {
  it("counts a run whose board lead is the owner's lead as a hit, and an error as a miss", () => {
    expect(metric("AI lead = owner lead")).toEqual({ name: "AI lead = owner lead", hits: 2, n: 4 });
  });

  it("counts a pick as usable when the model chose a story", () => {
    expect(metric("AI pick usable")).toEqual({ name: "AI pick usable", hits: 2, n: 4 });
  });

  it("counts the owner's lead on the shortlist, also for a run that failed", () => {
    expect(metric("Owner lead on shortlist")).toEqual({ name: "Owner lead on shortlist", hits: 4, n: 4 });
  });

  it("counts the score-only baseline, also for a run that failed", () => {
    expect(metric("Score-only lead = owner lead")).toEqual({ name: "Score-only lead = owner lead", hits: 1, n: 4 });
  });
});
