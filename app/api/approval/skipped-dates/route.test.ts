import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const store = vi.hoisted(() => ({
  findSkippedDate: vi.fn(),
  markSkippedDate: vi.fn(),
  unmarkSkippedDate: vi.fn(),
}));
vi.mock("@/src/pipeline/checks/skipped-dates", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/checks/skipped-dates")>()),
  ...store,
}));

import { DELETE, GET, POST } from "@/app/api/approval/skipped-dates/route";

const RECORD = { date: "2026-11-10", note: null, createdBy: "approval", createdAt: new Date("2026-11-10T15:00:00Z") };

async function request(method: "GET" | "POST" | "DELETE", options: { query?: string; body?: unknown; session?: boolean } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.session !== false) headers.cookie = `approval_session=${await createApprovalSessionToken("approval-secret")}`;
  return new Request(`http://localhost/api/approval/skipped-dates${options.query ?? ""}`, {
    method,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
}

describe("/api/approval/skipped-dates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-10T15:00:00Z")); // Tue 10:00 New York
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });
  afterEach(() => vi.useRealTimers());

  it("rejects requests without an approval session", async () => {
    const responses = await Promise.all([
      GET(await request("GET", { query: "?date=2026-11-10", session: false })),
      POST(await request("POST", { body: { date: "2026-11-10" }, session: false })),
      DELETE(await request("DELETE", { query: "?date=2026-11-10", session: false })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([401, 401, 401]);
    expect(store.findSkippedDate).not.toHaveBeenCalled();
    expect(store.markSkippedDate).not.toHaveBeenCalled();
    expect(store.unmarkSkippedDate).not.toHaveBeenCalled();
  });

  it("says whether a date is skipped and whether it can still change", async () => {
    store.findSkippedDate.mockResolvedValueOnce(RECORD).mockResolvedValueOnce(null);

    const today = await GET(await request("GET", { query: "?date=2026-11-10" }));
    const past = await GET(await request("GET", { query: "?date=2026-11-09" }));

    expect(await today.json()).toEqual({ date: "2026-11-10", skipped: { ...RECORD, createdAt: RECORD.createdAt.toISOString() }, canChange: true });
    expect(await past.json()).toEqual({
      date: "2026-11-09",
      skipped: null,
      canChange: false,
      reason: "The date is in the past. Only today or a later date can change.",
    });
  });

  it("marks today as a skipped date, with an optional note", async () => {
    store.markSkippedDate.mockResolvedValueOnce({ ...RECORD, note: "Holiday" });

    const response = await POST(await request("POST", { body: { date: "2026-11-10", note: "  Holiday " } }));

    expect(response.status).toBe(200);
    expect(store.markSkippedDate).toHaveBeenCalledWith("2026-11-10", { note: "Holiday", createdBy: "approval" });
  });

  it("undoes a skipped date the same day", async () => {
    store.unmarkSkippedDate.mockResolvedValueOnce(true);

    const response = await DELETE(await request("DELETE", { query: "?date=2026-11-10" }));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ date: "2026-11-10", undone: true });
  });

  it("refuses past dates, weekends and bad input", async () => {
    const responses = await Promise.all([
      POST(await request("POST", { body: { date: "2026-11-09" } })),
      DELETE(await request("DELETE", { query: "?date=2026-11-09" })),
      POST(await request("POST", { body: { date: "2026-11-14" } })),
      POST(await request("POST", { body: { date: "soon" } })),
      POST(await request("POST", { body: { date: "2026-11-10", note: "x".repeat(201) } })),
    ]);

    expect(responses.map((response) => response.status)).toEqual([400, 400, 400, 400, 400]);
    expect(store.markSkippedDate).not.toHaveBeenCalled();
    expect(store.unmarkSkippedDate).not.toHaveBeenCalled();
  });

  it("returns a 500 without details when the database fails", async () => {
    store.markSkippedDate.mockRejectedValueOnce(new Error("connection refused"));

    const response = await POST(await request("POST", { body: { date: "2026-11-10" } }));

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not save the skipped date." });
  });
});
