import { Prisma, type PrismaClient } from "@/src/generated/prisma";
import type { BoardActionRow } from "@/src/pipeline/feedback/board-diff";
import { prisma } from "@/src/server/prisma";

/** The client or a transaction: anything with the `boardAction` table. */
export type BoardActionDb = Pick<PrismaClient, "boardAction">;

/** Saves the board actions of one commit under its outline. Returns how many rows it wrote. */
export async function saveBoardActions(
  tx: BoardActionDb,
  outlineId: bigint,
  date: string,
  rows: BoardActionRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const issueDate = new Date(`${date}T00:00:00.000Z`);
  const { count } = await tx.boardAction.createMany({
    data: rows.map((row) => ({
      outlineId,
      issueDate,
      storyId: row.storyId,
      action: row.action,
      fromSection: row.fromSection,
      toSection: row.toSection,
      fromPosition: row.fromPosition,
      toPosition: row.toPosition,
      reasonCode: row.reasonCode,
      reasonText: row.reasonText,
      detail: row.detail === null ? Prisma.DbNull : (row.detail as Prisma.InputJsonValue),
    })),
  });
  return count;
}

/** The link of each story before a commit changes it, for the `link` board actions. */
export async function readStoredUrls(ids: number[]): Promise<Map<number, string | null>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.story.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, url: true } });
  return new Map(rows.map((row) => [Number(row.id), row.url]));
}
