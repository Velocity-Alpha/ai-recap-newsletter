import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    pipelineSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    pipelineRun: { create: vi.fn() },
  };
  return {
    tx,
    prisma: {
      $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
      pipelineRun: { findMany: vi.fn() },
    },
  };
});

vi.mock("@/src/server/prisma", () => ({ prisma: db.prisma }));

import {
  ADMIN_SETTING_JOB,
  changeStageOwner,
  listStageChanges,
} from "@/src/features/admin/change-stage-owner";

const NOW = new Date("2026-11-09T15:00:00Z");
const SESSION = { actor: "approval login" };

describe("changeStageOwner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.tx.pipelineRun.create.mockResolvedValue({ id: 77n });
  });

  it("refuses an unknown key or a value outside the config without touching the database", async () => {
    await expect(changeStageOwner({ key: "pipeline.runner", value: "trigger" }, SESSION, NOW)).resolves.toEqual({
      status: "invalid",
      reason: "pipeline.runner is not a stage switch.",
    });
    await expect(changeStageOwner({ key: "ingest.owner", value: "shadow" }, SESSION, NOW)).resolves.toMatchObject({
      status: "invalid",
    });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses native drafting while it is disabled", async () => {
    await expect(changeStageOwner({ key: "draft.owner", value: "native" }, SESSION, NOW)).resolves.toEqual({
      status: "invalid",
      reason: "Native drafting is not built yet (#79)",
    });
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("refuses a change to the value already set, and writes nothing", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "ingest.owner", value: "native" });

    await expect(changeStageOwner({ key: "ingest.owner", value: "native" }, SESSION, NOW)).resolves.toEqual({
      status: "unchanged",
      reason: "ingest.owner is already native. Nothing changed.",
    });
    expect(db.tx.pipelineSetting.upsert).not.toHaveBeenCalled();
    expect(db.tx.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("treats a missing row as the default, so n8n is a no-op there", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce(null);

    await expect(changeStageOwner({ key: "draft.owner", value: "n8n" }, SESSION, NOW)).resolves.toEqual({
      status: "unchanged",
      reason: "draft.owner is already n8n (not set, so the jobs use n8n). Nothing changed.",
    });
    expect(db.tx.pipelineSetting.upsert).not.toHaveBeenCalled();
  });

  it("writes the new value and logs time, old value, new value, and who, in one transaction", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "publish.owner", value: "native" });

    const result = await changeStageOwner({ key: "publish.owner", value: "n8n" }, SESSION, NOW);

    expect(result).toEqual({
      status: "changed",
      key: "publish.owner",
      from: "native",
      to: "n8n",
      by: "approval login",
      at: NOW,
      runId: 77n,
    });
    expect(db.prisma.$transaction).toHaveBeenCalledTimes(1);
    expect(db.tx.pipelineSetting.upsert).toHaveBeenCalledWith({
      where: { key: "publish.owner" },
      create: { key: "publish.owner", value: "n8n" },
      update: { value: "n8n" },
    });
    const change = { key: "publish.owner", from: "native", to: "n8n", by: "approval login" };
    expect(db.tx.pipelineRun.create).toHaveBeenCalledWith({
      data: {
        job: ADMIN_SETTING_JOB,
        trigger: "manual",
        status: "succeeded",
        startedAt: NOW,
        finishedAt: NOW,
        stats: change,
        events: {
          create: {
            level: "info",
            step: "setting.change",
            message: "publish.owner changed from native to n8n by approval login.",
            data: change,
            createdAt: NOW,
          },
        },
      },
      select: { id: true },
    });
    expect(ADMIN_SETTING_JOB).toBe("admin-setting");
  });

  it("logs a missing row as null, and says it was not set", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce(null);

    const result = await changeStageOwner({ key: "ingest.owner", value: "native" }, SESSION, NOW);

    expect(result).toMatchObject({ status: "changed", from: null, to: "native" });
    const data = db.tx.pipelineRun.create.mock.calls[0][0].data;
    expect(data.stats).toEqual({ key: "ingest.owner", from: null, to: "native", by: "approval login" });
    expect(data.events.create.message).toBe("ingest.owner changed from not set (n8n) to native by approval login.");
  });
});

describe("listStageChanges", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads the newest admin-setting runs and maps their stats", async () => {
    db.prisma.pipelineRun.findMany.mockResolvedValueOnce([
      {
        id: 78n,
        job: "admin-setting",
        startedAt: NOW,
        stats: { key: "ingest.owner", from: null, to: "native", by: "approval login" },
      },
      { id: 70n, job: "admin-setting", startedAt: NOW, stats: null },
    ]);

    const changes = await listStageChanges(10);

    expect(db.prisma.pipelineRun.findMany).toHaveBeenCalledWith({
      where: { job: "admin-setting" },
      orderBy: { id: "desc" },
      take: 10,
    });
    expect(changes).toEqual([
      { runId: "78", at: NOW, key: "ingest.owner", from: "not set", to: "native", by: "approval login" },
      { runId: "70", at: NOW, key: "unknown", from: "unknown", to: "unknown", by: "unknown" },
    ]);
  });
});
