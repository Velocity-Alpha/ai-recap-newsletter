import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  pipelineSetting: { findUnique: vi.fn(), upsert: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { readSetting, writeSetting } from "@/src/pipeline/settings";

describe("pipeline settings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a setting's JSON value", async () => {
    prismaMock.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "owner:ingest:tldr", value: "n8n" });

    await expect(readSetting("owner:ingest:tldr")).resolves.toBe("n8n");
    expect(prismaMock.pipelineSetting.findUnique).toHaveBeenCalledWith({ where: { key: "owner:ingest:tldr" } });
  });

  it("returns null for a missing setting", async () => {
    prismaMock.pipelineSetting.findUnique.mockResolvedValueOnce(null);

    await expect(readSetting("owner:ingest:tldr")).resolves.toBeNull();
  });

  it("creates or replaces a setting", async () => {
    prismaMock.pipelineSetting.upsert.mockResolvedValueOnce({});

    await writeSetting("threshold:stories:min-ratio", 0.5);

    expect(prismaMock.pipelineSetting.upsert).toHaveBeenCalledWith({
      where: { key: "threshold:stories:min-ratio" },
      create: { key: "threshold:stories:min-ratio", value: 0.5 },
      update: { value: 0.5 },
    });
  });
});
