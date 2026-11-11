import type { Prisma } from "@/src/generated/prisma";
import { hashOutline, type ApprovalOutline, type ProposedBoard } from "@/src/pipeline/draft/outline";
import { prisma } from "@/src/server/prisma";

/** Saves the outline, and the proposed board (#150) when the board sent one. The hash is of the outline only. */
export async function saveOutline(
  outline: ApprovalOutline,
  proposed: ProposedBoard | null = null,
): Promise<{ id: bigint; hash: string }> {
  const hash = hashOutline(outline);
  const row = await prisma.approvalOutline.create({
    data: {
      issueDate: new Date(`${outline.date}T00:00:00.000Z`),
      payload: outline as unknown as Prisma.InputJsonValue,
      payloadHash: hash,
      ...(proposed ? { proposed: proposed as unknown as Prisma.InputJsonValue } : {}),
    },
    select: { id: true },
  });
  return { id: row.id, hash };
}
