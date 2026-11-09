import { decidePublish } from "@/src/pipeline/publish/publish-decision";
import { createPrismaPublishStore, type PrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { parseSentEmail, type SentEmailParseResult } from "@/src/pipeline/publish/sent-email-parser";

/**
 * The "Mark as published" fallback (#64). Publishes a draft from the email HTML stored on the issue, the same
 * way native detection publishes from Gmail. No AI, no Gmail, no runner.
 */

export type ManualPublishStore = Pick<PrismaPublishStore, "findDraft" | "publish">;

export type ManualPublishStatus = "ready" | "already_published" | "not_found" | "no_email" | "wrong_issue";

export interface ManualPublishPreview {
  issueId: number;
  status: ManualPublishStatus;
  title: string;
  date: string;
  storyCount: number;
  problems: string[];
}

async function load(issueId: number, store: ManualPublishStore, now: Date) {
  const draft = await store.findDraft(issueId);
  const parsed = draft ? parseSentEmail(draft.html ?? "") : null;
  const preview: ManualPublishPreview = {
    issueId,
    status: "ready",
    title: parsed?.content.title || draft?.title || "",
    date: parsed?.content.date ?? "",
    storyCount: parsed?.storyIds.length ?? 0,
    problems: parsed?.problems ?? [],
  };

  if (!draft) return { preview: { ...preview, status: "not_found" as const }, parsed: null };
  if (draft.publishedAt) return { preview: { ...preview, status: "already_published" as const }, parsed: null };
  if (!parsed) return { preview: { ...preview, status: "no_email" as const }, parsed: null };
  if (parsed.content.issue_id !== issueId) return { preview: { ...preview, status: "wrong_issue" as const }, parsed: null };

  const outcome = decidePublish({ mode: "manual", parsed, issue: draft, sentAt: now });
  return outcome === "published"
    ? { preview, parsed }
    : { preview: { ...preview, status: "already_published" as const }, parsed: null };
}

export async function previewManualPublish(
  issueId: number,
  store: ManualPublishStore = createPrismaPublishStore(),
  now: Date = new Date(),
): Promise<ManualPublishPreview> {
  return (await load(issueId, store, now)).preview;
}

export async function manualPublish(
  issueId: number,
  now: Date,
  store: ManualPublishStore = createPrismaPublishStore(),
): Promise<{ outcome: ManualPublishStatus | "published"; preview: ManualPublishPreview }> {
  const { preview, parsed } = await load(issueId, store, now);
  if (preview.status !== "ready" || !parsed) return { outcome: preview.status, preview };

  const outcome = await store.publish({
    issueId,
    content: parsed.content,
    storyIds: parsed.storyIds,
    publishedAt: now,
    event: manualEvent(issueId, parsed),
  });
  return { outcome, preview };
}

function manualEvent(issueId: number, parsed: SentEmailParseResult) {
  return {
    mode: "manual" as const,
    outcome: "published" as const,
    gmailMessageId: null,
    receivedAt: null,
    issueId,
    subject: null,
    title: parsed.content.title,
    storyIds: parsed.storyIds,
    contentJson: parsed.content,
    problems: parsed.problems,
    draftId: parsed.draftId,
  };
}
