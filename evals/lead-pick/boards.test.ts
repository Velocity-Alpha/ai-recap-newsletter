import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { leadPickCases } from "@/evals/lead-pick/boards";

describe("leadPickCases", () => {
  it("builds one case per archived board", () => {
    expect(leadPickCases(new Map())).toHaveLength(11);
  });

  it("gives each board the earlier boards' leads as recently published", () => {
    const cases = leadPickCases(new Map());
    expect(cases[0].recentlyPublished).toEqual([]);
    expect(cases[10].recentlyPublished).toHaveLength(10);
  });

  it("gives each board a shortlist of 1 to 8 stories", () => {
    expect(leadPickCases(new Map()).every((entry) => entry.shortlist.length > 0 && entry.shortlist.length <= 8)).toBe(true);
  });

  it("leaves summaries empty when none are given", () => {
    expect(leadPickCases(new Map()).every((entry) => entry.shortlist.every((story) => story.summary === ""))).toBe(true);
  });

  it("adds the summaries it is given", () => {
    const first = leadPickCases(new Map())[0].shortlist[0];
    const cases = leadPickCases(new Map([[first.id, "A made-up summary."]]));
    expect(cases[0].shortlist.find((story) => story.id === first.id)?.summary).toBe("A made-up summary.");
  });
});
