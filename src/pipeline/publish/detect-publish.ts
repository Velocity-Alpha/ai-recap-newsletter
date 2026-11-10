import type { GmailReader } from "@/src/pipeline/publish/gmail-client";
import { decidePublish, type PublishMode, type PublishOutcome } from "@/src/pipeline/publish/publish-decision";
import { parseSentEmail, type PublishedIssueContent } from "@/src/pipeline/publish/sent-email-parser";

/**
 * Runner-agnostic publish detection: reads issue emails from the seed mailbox, decides what each one means,
 * records one `publish_events` row per Gmail message, and publishes the issue.
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
  /** The native draft the email was made from (`data-draft-id`); null for n8n's emails. */
  draftId: number | null;
  /** The staged version the email was made from (`data-version-id`); null for emails staged before #149. */
  versionId: number | null;
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
}

export interface DetectPublishSummary {
  listed: number;
  skipped: number;
  results: DetectPublishResult[];
  errors: Array<{ gmailMessageId: string; message: string }>;
}

/** Gmail search for issue emails received after `since` (Gmail takes epoch seconds in `after:`). */
export function buildPublishQuery(options: { recipients?: string[]; since: Date }): string {
  const recipients = (options.recipients ?? []).map((value) => value.trim()).filter(Boolean);
  const to = recipients.length > 0 ? ` (${recipients.map((value) => `to:${value}`).join(" OR ")})` : "";
  return `from:${NEWSLETTER_SENDER}${to} after:${Math.floor(options.since.getTime() / 1000)}`;
}

export async function detectPublish(
  deps: { gmail: GmailReader; store: PublishStore },
  /** `messageIds` as Gmail lists them, newest first. The caller lists them, so it can stop before the database. */
  options: { messageIds: string[] },
): Promise<DetectPublishSummary> {
  const { gmail, store } = deps;
  const mode = "native" as const;

  // Handle the oldest first, so the first copy of a send is the one that publishes.
  const listed = [...options.messageIds].reverse();
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
      const outcome = decidePublish({ mode, parsed, issue });
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
        draftId: parsed?.draftId ?? null,
        versionId: parsed?.versionId ?? null,
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
      summary.results.push(result);
    } catch (error) {
      summary.errors.push({ gmailMessageId, message: error instanceof Error ? error.message : String(error) });
    }
  }

  return summary;
}
