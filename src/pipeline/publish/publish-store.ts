import type { Prisma, PrismaClient } from "@/src/generated/prisma";
import type { PublishEventInput, PublishStore } from "@/src/pipeline/publish/detect-publish";
import type { PublishMode } from "@/src/pipeline/publish/publish-decision";
import { prisma } from "@/src/server/prisma";

export interface DraftIssue {
  id: number;
  title: string;
  issueDate: Date | null;
  publishedAt: Date | null;
  html: string | null;
}

export interface PrismaPublishStore extends PublishStore {
  findDraft(id: number): Promise<DraftIssue | null>;
  listRecentIssues(limit: number): Promise<DraftIssue[]>;
}

function eventData(event: PublishEventInput): Prisma.PublishEventCreateManyInput {
  return {
    mode: event.mode,
    outcome: event.outcome,
    gmailMessageId: event.gmailMessageId,
    receivedAt: event.receivedAt,
    issueId: event.issueId === null ? null : BigInt(event.issueId),
    subject: event.subject,
    title: event.title,
    storyIds: event.storyIds,
    contentJson: (event.contentJson ?? undefined) as Prisma.InputJsonValue | undefined,
    problems: event.problems,
  };
}

/** `stories.used_in_publication_date` is a DATE. Use the UTC calendar day of the send. */
function utcDay(value: Date): Date {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function toDraft(row: { id: bigint; title: string; issueDate: Date | null; publishedAt: Date | null; html: string | null }) {
  return { ...row, id: Number(row.id) };
}

export function createPrismaPublishStore(client: PrismaClient = prisma): PrismaPublishStore {
  return {
    async knownMessageIds(mode: PublishMode, gmailMessageIds: string[]) {
      if (gmailMessageIds.length === 0) return new Set();
      const rows = await client.publishEvent.findMany({
        where: { mode, gmailMessageId: { in: gmailMessageIds } },
        select: { gmailMessageId: true },
      });
      return new Set(rows.flatMap((row) => (row.gmailMessageId ? [row.gmailMessageId] : [])));
    },

    async findIssue(id: number) {
      const row = await client.issue.findUnique({
        where: { id: BigInt(id) },
        select: { id: true, publishedAt: true, contentJson: true },
      });
      return row ? { id: Number(row.id), publishedAt: row.publishedAt, contentJson: row.contentJson } : null;
    },

    async recordEvent(event: PublishEventInput) {
      // A concurrent run may have recorded the same message already. One row per (mode, message) is enough.
      await client.publishEvent.createMany({ data: [eventData(event)], skipDuplicates: true });
    },

    async publish({ issueId, content, storyIds, publishedAt, event }) {
      return client.$transaction(async (tx) => {
        // Only an unpublished issue changes, so a second copy or a later resend never moves published_at.
        const updated = await tx.issue.updateMany({
          where: { id: BigInt(issueId), publishedAt: null },
          data: {
            publishedAt,
            contentJson: content as unknown as Prisma.InputJsonValue,
            ...(content.title ? { title: content.title } : {}),
          },
        });
        const outcome = updated.count === 1 ? "published" : "already_published";
        if (outcome === "published" && storyIds.length > 0) {
          await tx.story.updateMany({
            where: { id: { in: storyIds } },
            data: { usedInPublicationDate: utcDay(publishedAt) },
          });
        }
        await tx.publishEvent.createMany({ data: [eventData({ ...event, outcome })], skipDuplicates: true });
        return outcome;
      });
    },

    async findDraft(id: number) {
      const row = await client.issue.findUnique({
        where: { id: BigInt(id) },
        select: { id: true, title: true, issueDate: true, publishedAt: true, html: true },
      });
      return row ? toDraft(row) : null;
    },

    async listRecentIssues(limit: number) {
      const rows = await client.issue.findMany({
        orderBy: { id: "desc" },
        take: limit,
        select: { id: true, title: true, issueDate: true, publishedAt: true, html: true },
      });
      return rows.map(toDraft);
    },
  };
}
