import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import { leadPickCases } from "@/evals/lead-pick/boards";
import { scoreLeadPick, type LeadPickOutput } from "@/evals/lead-pick/score";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";

const CASE = { ownerLeadId: 7, scoredLeadId: 9, shortlist: [{ id: 9 }, { id: 7 }] };
const outcome = (output: LeadPickOutput | null, item = CASE): Outcome<typeof CASE, LeadPickOutput> =>
  outcomeOf({ item, id: "2026-10-22", output, error: output ? null : "network" });

describe("scoreLeadPick", () => {
  it("counts AI hits, usable picks, the shortlist and the score-only baseline; an error is a miss for the AI only", () => {
    const metrics = scoreLeadPick([
      outcome({ boardLeadId: 7, pickedId: 7 }),
      outcome({ boardLeadId: 9, pickedId: null }),
      outcome(null),
      outcome({ boardLeadId: 9, pickedId: 9 }, { ownerLeadId: 9, scoredLeadId: 9, shortlist: [{ id: 9 }] }),
    ]);
    expect(metrics).toEqual([
      { name: "AI lead = owner lead", hits: 2, n: 4 },
      { name: "AI pick usable", hits: 2, n: 4 },
      { name: "Owner lead on shortlist", hits: 4, n: 4 },
      { name: "Score-only lead = owner lead", hits: 1, n: 4 },
    ]);
  });
});

describe("leadPickCases", () => {
  it("builds the 10 archived boards, with earlier leads as recently published", () => {
    const cases = leadPickCases(new Map());
    expect(cases).toHaveLength(10);
    expect(cases[0].recentlyPublished).toEqual([]);
    expect(cases[9].recentlyPublished).toHaveLength(9);
    expect(cases.every((entry) => entry.shortlist.length > 0 && entry.shortlist.length <= 8)).toBe(true);
    expect(cases.every((entry) => entry.shortlist.every((story) => story.summary === ""))).toBe(true);
  });

  it("adds the summaries it is given", () => {
    const first = leadPickCases(new Map())[0].shortlist[0];
    const cases = leadPickCases(new Map([[first.id, "A made-up summary."]]));
    expect(cases[0].shortlist.find((story) => story.id === first.id)?.summary).toBe("A made-up summary.");
  });
});
