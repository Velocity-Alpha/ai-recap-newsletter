import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  approvalOutline: { create: vi.fn(), update: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { markOutlineForwarded } from "@/src/pipeline/draft/outline-store";

describe("markOutlineForwarded", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets forwarded_at on the saved outline", async () => {
    prismaMock.approvalOutline.update.mockResolvedValueOnce({});
    const now = new Date("2026-11-09T14:05:00.000Z");

    await markOutlineForwarded(BigInt(7), now);

    expect(prismaMock.approvalOutline.update).toHaveBeenCalledWith({
      where: { id: BigInt(7) },
      data: { forwardedAt: now },
      select: { id: true },
    });
  });
});
