import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { sceneIssueFrom } from "@/evals/scenes/issue-context";

describe("sceneIssueFrom", () => {
  it("builds the context the draft builds: the subject line and the top stories' headline and detail", () => {
    const issue = sceneIssueFrom({
      id: "262",
      date: "2026-10-26",
      content: {
        title: "A Made-Up Subject",
        headlines: [{ story_id: 1, url: "https://example.com", headline: "Made-up headline", story_detail: "Made-up detail.", bullets: [] }],
      } as never,
    });
    expect(issue).toEqual({
      issueId: 262,
      date: "2026-10-26",
      context: { subjectLine: "A Made-Up Subject", topStories: [{ headline: "Made-up headline", detail: "Made-up detail." }] },
    });
  });
});
