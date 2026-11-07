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
  };
}

const draft = { id: 268, publishedAt: null };

describe("decidePublish", () => {
  it("ignores an email that is not an issue", () => {
    expect(decidePublish({ mode: "native", parsed: null, issue: null, sentAt: SENT_AT })).toBe("not_an_issue");
  });

  it("flags an issue id that is not in the database", () => {
    expect(decidePublish({ mode: "native", parsed: parsed(), issue: null, sentAt: SENT_AT })).toBe("unknown_issue");
  });

  it("publishes a clean draft in native and manual mode, and only records it in shadow mode", () => {
    expect(decidePublish({ mode: "native", parsed: parsed(), issue: draft, sentAt: SENT_AT })).toBe("published");
    expect(decidePublish({ mode: "manual", parsed: parsed(), issue: draft, sentAt: SENT_AT })).toBe("published");
    expect(decidePublish({ mode: "shadow", parsed: parsed(), issue: draft, sentAt: SENT_AT })).toBe("would_publish");
  });

  it("never publishes an issue twice in native or manual mode", () => {
    const published = { id: 268, publishedAt: SENT_AT };

    expect(decidePublish({ mode: "native", parsed: parsed(), issue: published, sentAt: SENT_AT })).toBe(
      "already_published",
    );
    expect(decidePublish({ mode: "manual", parsed: parsed(), issue: published, sentAt: SENT_AT })).toBe(
      "already_published",
    );
  });

  it("in shadow mode, treats a publish from the same send as n8n's work, and an earlier one as already published", () => {
    const sameSend = { id: 268, publishedAt: new Date(SENT_AT.getTime() - 30_000) };
    const earlierSend = { id: 268, publishedAt: new Date("2026-11-03T15:00:00.000Z") };

    expect(decidePublish({ mode: "shadow", parsed: parsed(), issue: sameSend, sentAt: SENT_AT })).toBe(
      "would_publish",
    );
    expect(decidePublish({ mode: "shadow", parsed: parsed(), issue: earlierSend, sentAt: SENT_AT })).toBe(
      "already_published",
    );
  });

  it("holds an email with parse problems for review, except for a manual publish", () => {
    const withProblems = parsed(["No overview summary found."]);

    expect(decidePublish({ mode: "native", parsed: withProblems, issue: draft, sentAt: SENT_AT })).toBe(
      "needs_review",
    );
    expect(decidePublish({ mode: "shadow", parsed: withProblems, issue: draft, sentAt: SENT_AT })).toBe(
      "needs_review",
    );
    expect(decidePublish({ mode: "manual", parsed: withProblems, issue: draft, sentAt: SENT_AT })).toBe("published");
  });
});
