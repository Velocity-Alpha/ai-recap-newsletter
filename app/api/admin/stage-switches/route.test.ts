import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => {
  const tx = {
    pipelineSetting: { findUnique: vi.fn(), upsert: vi.fn() },
    pipelineRun: { create: vi.fn() },
  };
  return { tx, prisma: { $transaction: vi.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)) } };
});

vi.mock("@/src/server/prisma", () => ({ prisma: db.prisma }));
vi.mock("@/src/server/observability", () => ({ logServerInfo: vi.fn(), logServerError: vi.fn() }));

import { POST } from "@/app/api/admin/stage-switches/route";
import { APPROVAL_SESSION_COOKIE_NAME, createApprovalSessionToken } from "@/src/server/approval-auth";

async function post(body: unknown, withSession = true) {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (withSession) headers.cookie = `${APPROVAL_SESSION_COOKIE_NAME}=${await createApprovalSessionToken()}`;
  const request = new Request("http://localhost/api/admin/stage-switches", {
    method: "POST",
    headers,
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
  return POST(request, {});
}

describe("POST /api/admin/stage-switches", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("APPROVAL_PASSWORD", "approval-secret");
    vi.stubEnv("SESSION_SECRET", "test-session-secret");
    db.tx.pipelineRun.create.mockResolvedValue({ id: 91n });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("re-checks the session: 401 and no database access without one", async () => {
    const response = await post({ key: "ingest.owner", value: "n8n" }, false);

    expect(response.status).toBe(401);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers 400 for a body that is not JSON", async () => {
    const response = await post("not json");

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Send JSON with a key and a value." });
  });

  it("answers 400 for a key or value outside the config", async () => {
    const unknownKey = await post({ key: "pipeline.runner", value: "trigger" });
    const badValue = await post({ key: "publish.owner", value: "shadow" });

    expect(unknownKey.status).toBe(400);
    expect(await unknownKey.json()).toEqual({ error: "pipeline.runner is not a stage switch." });
    expect(badValue.status).toBe(400);
    expect(db.prisma.$transaction).not.toHaveBeenCalled();
  });

  it("answers 400 for native drafting while it is disabled", async () => {
    const response = await post({ key: "draft.owner", value: "native" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Native drafting is not built yet (#79)" });
  });

  it("answers 409 for a no-op change and writes nothing", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "ingest.owner", value: "native" });

    const response = await post({ key: "ingest.owner", value: "native" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "ingest.owner is already native. Nothing changed." });
    expect(db.tx.pipelineSetting.upsert).not.toHaveBeenCalled();
    expect(db.tx.pipelineRun.create).not.toHaveBeenCalled();
  });

  it("changes the setting, logs it, and returns the change with its run id", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "ingest.owner", value: "native" });

    const response = await post({ key: "ingest.owner", value: "n8n" });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.change).toMatchObject({
      key: "ingest.owner",
      from: "native",
      to: "n8n",
      by: "approval login",
      runId: "91",
    });
    expect(new Date(body.change.at).toString()).not.toBe("Invalid Date");
    expect(db.tx.pipelineSetting.upsert).toHaveBeenCalledTimes(1);
    expect(db.tx.pipelineRun.create).toHaveBeenCalledTimes(1);
  });

  it("changes publish.owner away from shadow: 200, and the log says from shadow", async () => {
    db.tx.pipelineSetting.findUnique.mockResolvedValueOnce({ key: "publish.owner", value: "shadow" });

    const response = await post({ key: "publish.owner", value: "native" });

    expect(response.status).toBe(200);
    expect((await response.json()).change).toMatchObject({ key: "publish.owner", from: "shadow", to: "native" });
    const data = db.tx.pipelineRun.create.mock.calls[0][0].data;
    expect(data.stats).toEqual({ key: "publish.owner", from: "shadow", to: "native", by: "approval login" });
    expect(data.events.create.data).toEqual(data.stats);
  });

  it("answers 409 when a concurrent change wins (Prisma P2034), and says nothing was saved", async () => {
    db.prisma.$transaction.mockRejectedValueOnce(
      Object.assign(new Error("Transaction failed due to a write conflict or a deadlock."), { code: "P2034" }),
    );

    const response = await post({ key: "ingest.owner", value: "n8n" });

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: "Another change to ingest.owner happened at the same time. Nothing was saved. Reload the page and try again.",
    });
  });

  it("answers 500 when the database fails", async () => {
    db.tx.pipelineSetting.findUnique.mockRejectedValueOnce(new Error("connection lost"));

    const response = await post({ key: "ingest.owner", value: "n8n" });

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Could not change the setting. Nothing was saved." });
  });
});
