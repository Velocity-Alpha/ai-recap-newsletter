import { beforeEach, describe, expect, it, vi } from "vitest";

const matchStoriesMock = vi.hoisted(() => vi.fn());
const store = vi.hoisted(() => ({ name: "prisma store" }));

vi.mock("@/src/pipeline/repeats/match-stories", () => ({ matchStories: matchStoriesMock }));
vi.mock("@/src/pipeline/repeats/repeats-store", () => ({
  createPrismaRepeatsStore: vi.fn(() => store),
  readRepeatWindowDays: vi.fn(async () => 10),
}));

import { createRepeatCheck } from "@/src/pipeline/repeats/repeat-check";

beforeEach(() => {
  matchStoriesMock.mockReset();
});

describe("createRepeatCheck", () => {
  it("checks the given stories with the store and the window setting", async () => {
    matchStoriesMock.mockResolvedValue({ embedded: 2, judged: 1, pairs: 3, refused: 0 });
    await expect(createRepeatCheck({ apiKey: "key" })([1, 2])).resolves.toEqual({ checked: 2, embedded: 2, judged: 1, pairs: 3, refused: 0 });
    const [ids, deps] = matchStoriesMock.mock.calls[0];
    expect(ids).toEqual([1, 2]);
    expect(deps).toMatchObject({ store, windowDays: 10 });
  });

  it("counts failed judge requests and keeps the first error", async () => {
    matchStoriesMock.mockImplementation(async (_ids: number[], deps: { onJudgeError: (id: number, error: unknown) => void }) => {
      deps.onJudgeError(5, new Error("HTTP 500"));
      deps.onJudgeError(6, new Error("HTTP 502"));
      return { embedded: 0, judged: 0, pairs: 0, refused: 0 };
    });
    await expect(createRepeatCheck({ apiKey: "key" })([5, 6])).resolves.toMatchObject({ failed: { count: 2, firstError: "HTTP 500" } });
  });
});
