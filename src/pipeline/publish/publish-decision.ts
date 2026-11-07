import type { SentEmailParseResult } from "@/src/pipeline/publish/sent-email-parser";

/** shadow: record what native would do. native: publish from Gmail. manual: the admin "Mark as published" button. */
export type PublishMode = "shadow" | "native" | "manual";

/** Matches the CHECK constraint on `newsletter.publish_events.outcome`. */
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

// Both seed copies of one send arrive within about 30 s. In shadow mode n8n has usually published the issue
// from one of them already, so a publish this close to the email is the same send, not an earlier one.
const SAME_SEND_WINDOW_MS = 10 * 60_000;

export function decidePublish(input: {
  mode: PublishMode;
  parsed: SentEmailParseResult | null;
  issue: IssuePublishState | null;
  sentAt: Date;
}): PublishOutcome {
  const { mode, parsed, issue, sentAt } = input;
  if (!parsed) return "not_an_issue";
  if (!issue) return "unknown_issue";

  if (issue.publishedAt) {
    const earlierSend = issue.publishedAt.getTime() < sentAt.getTime() - SAME_SEND_WINDOW_MS;
    if (mode !== "shadow" || earlierSend) return "already_published";
  }

  // A person pressing "Mark as published" has seen the problems; automatic paths wait for review.
  if (parsed.problems.length > 0 && mode !== "manual") return "needs_review";

  return mode === "shadow" ? "would_publish" : "published";
}
