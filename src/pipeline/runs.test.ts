import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({
  pipelineRun: { create: vi.fn(), update: vi.fn() },
  pipelineEvent: { create: vi.fn() },
}));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";

const now = new Date("2026-11-06T15:00:00.000Z");

describe("pipeline runs", () => {
  beforeEach(() => vi.clearAllMocks());

  it("starts a run in the running state and returns its id", async () => {
    prismaMock.pipelineRun.create.mockResolvedValueOnce({ id: 42n });

    await expect(startRun({ job: "outcome-check:stories", trigger: "schedule" }, now)).resolves.toBe(42n);
    expect(prismaMock.pipelineRun.create).toHaveBeenCalledWith({
      data: { job: "outcome-check:stories", trigger: "schedule", status: "running", startedAt: now },
      select: { id: true },
    });
  });

  it("finishes a run with its status, stats and error", async () => {
    prismaMock.pipelineRun.update.mockResolvedValueOnce({});

    await finishRun(42n, { status: "failed", stats: { stories: 0 }, error: "timeout" }, now);

    expect(prismaMock.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { status: "failed", finishedAt: now, stats: { stories: 0 }, error: "timeout" },
    });
  });

  it("finishes a successful run without stats or error", async () => {
    prismaMock.pipelineRun.update.mockResolvedValueOnce({});

    await finishRun(42n, { status: "succeeded" }, now);

    expect(prismaMock.pipelineRun.update).toHaveBeenCalledWith({
      where: { id: 42n },
      data: { status: "succeeded", finishedAt: now, stats: undefined, error: null },
    });
  });

  it("appends a step event to the run log", async () => {
    prismaMock.pipelineEvent.create.mockResolvedValueOnce({});

    await logEvent(42n, { level: "warn", step: "fetch:tldr", message: "Feed returned 0 items", data: { url: "x" } });

    expect(prismaMock.pipelineEvent.create).toHaveBeenCalledWith({
      data: { runId: 42n, level: "warn", step: "fetch:tldr", message: "Feed returned 0 items", data: { url: "x" } },
    });
  });
});
