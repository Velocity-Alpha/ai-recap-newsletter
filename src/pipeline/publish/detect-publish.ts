import { diffIssueContent } from "@/src/pipeline/publish/content-diff";
import type { GmailReader } from "@/src/pipeline/publish/gmail-client";
import { decidePublish, type PublishMode, type PublishOutcome } from "@/src/pipeline/publish/publish-decision";
import { parseSentEmail, type PublishedIssueContent } from "@/src/pipeline/publish/sent-email-parser";

/**
 * Runner-agnostic publish detection: reads issue emails from the seed mailbox, decides what each one means,
 * and records one `publish_events` row per Gmail message and mode. In native mode it also publishes.
 */

export const NEWSLETTER_SENDER = "newsletter@airecap.news";

/** One `newsletter.publish_events` row. */
export interface PublishEventInput {
  mode: PublishMode;
  outcome: PublishOutcome;
  gmailMessageId: string | null;
  receivedAt: Date | null;
  issueId: number | null;
  subject: string | null;
  title: string | null;
  storyIds: number[];
  contentJson: PublishedIssueContent | null;
  problems: string[];
}

export interface StoredIssue {
  id: number;
  publishedAt: Date | null;
  contentJson: unknown;
}

export interface PublishStore {
  knownMessageIds(mode: PublishMode, gmailMessageIds: string[]): Promise<Set<string>>;
  findIssue(id: number): Promise<StoredIssue | null>;
  recordEvent(event: PublishEventInput): Promise<void>;
  /**
   * In one transaction: publish the issue if it is still unpublished, mark its stories used, and record the
   * event with the real outcome. Returns `already_published` if another writer got there first.
   */
  publish(input: {
    issueId: number;
    content: PublishedIssueContent;
    storyIds: number[];
    publishedAt: Date;
    event: PublishEventInput;
  }): Promise<"published" | "already_published">;
}

export interface DetectPublishResult {
  gmailMessageId: string;
  issueId: number | null;
  outcome: PublishOutcome;
  /** Shadow mode only: how this email's content differs from the stored `content_json`. */
  differences?: string[];
}

export interface DetectPublishSummary {
  listed: number;
  skipped: number;
  results: DetectPublishResult[];
  errors: Array<{ gmailMessageId: string; message: string }>;
}

export function buildPublishQuery(options: { recipients?: string[]; lookbackDays?: number }): string {
  const recipients = (options.recipients ?? []).map((value) => value.trim()).filter(Boolean);
  const to = recipients.length > 0 ? ` (${recipients.map((value) => `to:${value}`).join(" OR ")})` : "";
  return `from:${NEWSLETTER_SENDER}${to} newer_than:${options.lookbackDays ?? 3}d`;
}

export async function detectPublish(
  deps: { gmail: GmailReader; store: PublishStore },
  options: { mode: Exclude<PublishMode, "manual">; query: string; limit: number },
): Promise<DetectPublishSummary> {
  const { gmail, store } = deps;
  const { mode } = options;

  // Gmail lists newest first. Handle the oldest first, so the first copy of a send is the one that publishes.
  const listed = (await gmail.listMessageIds(options.query, options.limit)).reverse();
  const known = await store.knownMessageIds(mode, listed);
  const summary: DetectPublishSummary = { listed: listed.length, skipped: 0, results: [], errors: [] };

  for (const gmailMessageId of listed) {
    if (known.has(gmailMessageId)) {
      summary.skipped += 1;
      continue;
    }
    try {
      const message = await gmail.getMessage(gmailMessageId);
      const parsed = parseSentEmail(message.html);
      const issue = parsed ? await store.findIssue(parsed.content.issue_id) : null;
      const outcome = decidePublish({ mode, parsed, issue, sentAt: message.sentAt });
      const event: PublishEventInput = {
        mode,
        outcome,
        gmailMessageId,
        receivedAt: message.sentAt,
        issueId: parsed?.content.issue_id ?? null,
        subject: message.subject || null,
        title: parsed?.content.title ?? null,
        storyIds: parsed?.storyIds ?? [],
        contentJson: parsed?.content ?? null,
        problems: parsed?.problems ?? [],
      };

      const result: DetectPublishResult = { gmailMessageId, issueId: event.issueId, outcome };
      if (outcome === "published" && parsed) {
        result.outcome = await store.publish({
          issueId: parsed.content.issue_id,
          content: parsed.content,
          storyIds: parsed.storyIds,
          publishedAt: message.sentAt,
          event,
        });
      } else {
        await store.recordEvent(event);
      }
      if (mode === "shadow" && parsed && issue?.contentJson) {
        result.differences = diffIssueContent(parsed.content, issue.contentJson);
      }
      summary.results.push(result);
    } catch (error) {
      summary.errors.push({ gmailMessageId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return summary;
}
