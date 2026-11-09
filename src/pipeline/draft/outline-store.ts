import type { Prisma } from "@/src/generated/prisma";
import { hashOutline, type ApprovalOutline } from "@/src/pipeline/draft/outline";
import { readSetting } from "@/src/pipeline/settings";
import { prisma } from "@/src/server/prisma";

/** Rule R1: one owner for drafting. Anything but `native` means n8n drafts (the default). */
export const DRAFT_OWNER_KEY = "draft.owner";
export type DraftOwner = "n8n" | "native";

export async function readDraftOwner(): Promise<DraftOwner> {
  return (await readSetting(DRAFT_OWNER_KEY)) === "native" ? "native" : "n8n";
}

export async function saveOutline(outline: ApprovalOutline, owner: DraftOwner): Promise<{ id: bigint; hash: string }> {
  const hash = hashOutline(outline);
  const row = await prisma.approvalOutline.create({
    data: {
      issueDate: new Date(`${outline.date}T00:00:00.000Z`),
      payload: outline as unknown as Prisma.InputJsonValue,
      payloadHash: hash,
      draftOwner: owner,
    },
    select: { id: true },
  });
  return { id: row.id, hash };
}

/** Records that n8n accepted the forwarded commit (2xx). Native drafting leaves `forwarded_at` null. */
export async function markOutlineForwarded(id: bigint, now: Date = new Date()): Promise<void> {
  await prisma.approvalOutline.update({ where: { id }, data: { forwardedAt: now }, select: { id: true } });
}
