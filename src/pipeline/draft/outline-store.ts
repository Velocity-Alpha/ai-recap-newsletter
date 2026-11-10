import type { Prisma } from "@/src/generated/prisma";
import { hashOutline, type ApprovalOutline } from "@/src/pipeline/draft/outline";
import { prisma } from "@/src/server/prisma";

export async function saveOutline(outline: ApprovalOutline): Promise<{ id: bigint; hash: string }> {
  const hash = hashOutline(outline);
  const row = await prisma.approvalOutline.create({
    data: {
      issueDate: new Date(`${outline.date}T00:00:00.000Z`),
      payload: outline as unknown as Prisma.InputJsonValue,
      payloadHash: hash,
    },
    select: { id: true },
  });
  return { id: row.id, hash };
}
