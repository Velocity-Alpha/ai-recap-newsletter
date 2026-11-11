import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { boardStoryIds } from "@/evals/lead-pick/boards";
import { readBoardSummaries } from "@/evals/lead-pick/summaries";

describe("readBoardSummaries", () => {
  it("reads a summary for each story on the archived boards, keyed by story id", () => {
    const summaries = readBoardSummaries();
    expect([...summaries.keys()].sort((a, b) => a - b)).toEqual([...boardStoryIds()].sort((a, b) => a - b));
  });

  it("holds no empty summary", () => {
    expect([...readBoardSummaries().values()].every((summary) => summary.trim() !== "")).toBe(true);
  });
});
