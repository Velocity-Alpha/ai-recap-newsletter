import type { SentEmailParseResult } from "@/src/pipeline/publish/sent-email-parser";

/** native: publish from Gmail. manual: the admin "Mark as published" button. */
export type PublishMode = "native" | "manual";

/**
 * Matches the CHECK constraint on `newsletter.publish_events.outcome`. `would_publish` is only in old rows, from
 * the test period before native publishing went live.
 */
export type PublishOutcome =
  | "published"
  | "would_publish"
  | "already_published"
  | "unknown_issue"
  | "not_an_issue"
  | "needs_review";

export interface IssuePublishState {
  id: number;
  publishedAt: Date | null;
}

export function decidePublish(input: {
  mode: PublishMode;
  parsed: SentEmailParseResult | null;
  issue: IssuePublishState | null;
}): PublishOutcome {
  const { mode, parsed, issue } = input;
  if (!parsed) return "not_an_issue";
  if (!issue) return "unknown_issue";

  if (issue.publishedAt) return "already_published";

  // A person pressing "Mark as published" has seen the problems; automatic paths wait for review.
  if (parsed.problems.length > 0 && mode !== "manual") return "needs_review";

  return "published";
}
