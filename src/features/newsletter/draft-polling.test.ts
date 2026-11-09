import { describe, expect, it } from "vitest";

import { BACKOFF_POLL_MS, nextDraftPoll, POLL_MS } from "@/src/features/newsletter/draft-polling";

describe("nextDraftPoll", () => {
  it("polls every few seconds while the draft runs, and stops once it is done", () => {
    expect(nextDraftPoll({ kind: "draft", status: "running" }, 0)).toBe(POLL_MS);
    expect(nextDraftPoll({ kind: "draft", status: "ready" }, 0)).toBeNull();
    expect(nextDraftPoll({ kind: "draft", status: "failed" }, 0)).toBeNull();
  });

  it("keeps polling after a server error or a lost connection, slower the first time", () => {
    expect(nextDraftPoll({ kind: "error", httpStatus: 500 }, 1)).toBe(POLL_MS * 2);
    expect(nextDraftPoll({ kind: "error", httpStatus: 503 }, 1)).toBe(POLL_MS * 2);
    expect(nextDraftPoll({ kind: "network" }, 1)).toBe(POLL_MS * 2);
  });

  it("backs off to 10 seconds after repeated errors", () => {
    expect(BACKOFF_POLL_MS).toBe(10_000);
    expect(nextDraftPoll({ kind: "error", httpStatus: 502 }, 2)).toBe(BACKOFF_POLL_MS);
    expect(nextDraftPoll({ kind: "network" }, 5)).toBe(BACKOFF_POLL_MS);
  });

  it("stops for good when signed out or the draft is gone", () => {
    expect(nextDraftPoll({ kind: "error", httpStatus: 401 }, 1)).toBeNull();
    expect(nextDraftPoll({ kind: "error", httpStatus: 404 }, 1)).toBeNull();
    expect(nextDraftPoll({ kind: "error", httpStatus: 404 }, 3)).toBeNull();
  });
});
