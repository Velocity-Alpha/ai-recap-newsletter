import { beforeEach, describe, expect, it, vi } from "vitest";

const prismaMock = vi.hoisted(() => ({ pipelineSetting: { findMany: vi.fn() } }));

vi.mock("@/src/server/prisma", () => ({ prisma: prismaMock }));

import { readSettings } from "@/src/features/admin/settings";

const UPDATED = new Date("2026-11-09T04:05:00Z");

describe("readSettings", () => {
  beforeEach(() => vi.clearAllMocks());

  it("lists every pipeline_settings row by key, with its JSON value and update time", async () => {
    prismaMock.pipelineSetting.findMany.mockResolvedValueOnce([
      { key: "check.deadline", value: "18:00", updatedAt: UPDATED },
      { key: "pipeline.runner", value: "netlify", updatedAt: UPDATED },
      { key: "threshold:stories:min-ratio", value: { ratio: 0.5 }, updatedAt: UPDATED },
    ]);

    const settings = await readSettings();

    expect(prismaMock.pipelineSetting.findMany).toHaveBeenCalledWith({ orderBy: { key: "asc" } });
    expect(settings.rows).toEqual([
      { key: "check.deadline", value: '"18:00"', updatedAt: UPDATED },
      { key: "pipeline.runner", value: '"netlify"', updatedAt: UPDATED },
      { key: "threshold:stories:min-ratio", value: '{"ratio":0.5}', updatedAt: UPDATED },
    ]);
  });
});
