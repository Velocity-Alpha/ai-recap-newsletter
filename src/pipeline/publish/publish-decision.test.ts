import { describe, expect, it } from "vitest";

import { decidePublish } from "@/src/pipeline/publish/publish-decision";
import type { SentEmailParseResult } from "@/src/pipeline/publish/sent-email-parser";

const SENT_AT = new Date("2026-11-03T17:48:22.000Z");

function parsed(problems: string[] = []): SentEmailParseResult {
  return {
    content: {
      schemaVersion: 2,
      featured_image_url: "",
      title: "T",
      date: "2026-11-03",
      issue_id: 268,
      overview: { summary: "S" },
      headlines: [],
      research_and_analysis: [],
      tools: [],
      quick_hits: [],
    },
    storyIds: [1],
    problems,
    draftId: null,
  };
}

const draft = { id: 268, publishedAt: null };

describe("decidePublish", () => {
  it("ignores an email that is not an issue", () => {
    expect(decidePublish({ mode: "native", parsed: null, issue: null })).toBe("not_an_issue");
  });

  it("flags an issue id that is not in the database", () => {
    expect(decidePublish({ mode: "native", parsed: parsed(), issue: null })).toBe("unknown_issue");
  });

  it("publishes a clean draft in native and manual mode", () => {
    expect(decidePublish({ mode: "native", parsed: parsed(), issue: draft })).toBe("published");
    expect(decidePublish({ mode: "manual", parsed: parsed(), issue: draft })).toBe("published");
  });

  it("never publishes an issue twice", () => {
    const published = { id: 268, publishedAt: SENT_AT };

    expect(decidePublish({ mode: "native", parsed: parsed(), issue: published })).toBe(
      "already_published",
    );
    expect(decidePublish({ mode: "manual", parsed: parsed(), issue: published })).toBe(
      "already_published",
    );
  });

  it("holds an email with parse problems for review, except for a manual publish", () => {
    const withProblems = parsed(["No overview summary found."]);

    expect(decidePublish({ mode: "native", parsed: withProblems, issue: draft })).toBe(
      "needs_review",
    );
    expect(decidePublish({ mode: "manual", parsed: withProblems, issue: draft })).toBe("published");
  });
});
