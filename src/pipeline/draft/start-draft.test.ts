import { describe, expect, it, vi } from "vitest";

import { DRAFT_BACKGROUND_PATH, readDraftJobRequest, startDraftJob } from "@/src/pipeline/draft/start-draft";
import { createJobToken, JOB_TOKEN_TTL_MS } from "@/src/server/job-token";

const SECRET = "s".repeat(32);
const NOW = new Date("2027-01-04T15:00:00.000Z");
const PUBLISHED = { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "d1", published: true } };
const PREVIEW = { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "abc123", published: false } };
const URL = `https://airecap.news${DRAFT_BACKGROUND_PATH}`;

function accepted() {
  return vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
}

function request(init: { token?: string; method?: string; body?: string }) {
  return new Request(URL, {
    method: init.method ?? "POST",
    headers: init.token ? { authorization: `Bearer ${init.token}` } : {},
    body: init.body,
  });
}

describe("startDraftJob", () => {
  it("starts the background function for one draft with a short-lived draft-issue token", async () => {
    const fetch = accepted();

    const result = await startDraftJob(41, PUBLISHED, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch });

    expect(result).toEqual({ status: "started" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://airecap.news/.netlify/functions/draft-issue-background");
    expect(init?.method).toBe("POST");
    // A redirect would turn the POST into a GET, which Netlify answers 202 and then ignores.
    expect(init?.redirect).toBe("error");
    await expect(readDraftJobRequest(new Request(url, init), { SESSION_SECRET: SECRET }, NOW)).resolves.toBe(41);
  });

  it("calls a preview's own address, or the address it is given", async () => {
    const fetch = accepted();
    await startDraftJob(41, PREVIEW, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch });
    await startDraftJob("42", { siteUrl: "http://localhost:8888/" }, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://abc123--ai-recap.netlify.app/.netlify/functions/draft-issue-background",
      "http://localhost:8888/.netlify/functions/draft-issue-background",
    ]);
  });

  it("names a missing secret or site address, and starts nothing", async () => {
    const fetch = accepted();
    await expect(startDraftJob(41, PUBLISHED, { env: {}, now: () => NOW, fetch })).resolves.toEqual({
      status: "not_configured",
      reason: "Missing setting: SESSION_SECRET.",
    });
    await expect(startDraftJob(41, undefined, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch })).resolves.toEqual({
      status: "not_configured",
      reason: "Missing the site address.",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails when the background function does not accept the job", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(startDraftJob(41, PUBLISHED, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch })).rejects.toThrow(
      "Starting the draft job failed with HTTP 404.",
    );
  });

  it("fails in plain words when the call is redirected or cannot connect", async () => {
    const fetch = vi.fn(async () => Promise.reject(new TypeError("fetch failed", { cause: new Error("unexpected redirect") })));
    await expect(startDraftJob(41, PUBLISHED, { env: { SESSION_SECRET: SECRET }, now: () => NOW, fetch })).rejects.toThrow(
      "Starting the draft job failed: fetch failed (unexpected redirect).",
    );
  });
});

describe("readDraftJobRequest", () => {
  const env = { SESSION_SECRET: SECRET };
  const token = createJobToken("draft-issue", SECRET, NOW, "41");
  const body = JSON.stringify({ draftId: 41 });

  it("returns the draft id from a POST with a valid draft-issue token for that draft", async () => {
    await expect(readDraftJobRequest(request({ token, body }), env, NOW)).resolves.toBe(41);
  });

  it("rejects a token signed for another draft, or for no draft", async () => {
    await expect(readDraftJobRequest(request({ token, body: JSON.stringify({ draftId: 42 }) }), env, NOW)).resolves.toBeNull();
    const unsigned = createJobToken("draft-issue", SECRET, NOW);
    await expect(readDraftJobRequest(request({ token: unsigned, body }), env, NOW)).resolves.toBeNull();
  });

  it("rejects a missing token, a token for another job, an expired token, a GET, and a missing secret", async () => {
    const ingestToken = createJobToken("ingest-stories", SECRET, NOW, "41");
    const later = new Date(NOW.getTime() + JOB_TOKEN_TTL_MS + 1);

    await expect(readDraftJobRequest(request({ body }), env, NOW)).resolves.toBeNull();
    await expect(readDraftJobRequest(request({ token: ingestToken, body }), env, NOW)).resolves.toBeNull();
    await expect(readDraftJobRequest(request({ token, body }), env, later)).resolves.toBeNull();
    await expect(readDraftJobRequest(request({ token, method: "GET" }), env, NOW)).resolves.toBeNull();
    await expect(readDraftJobRequest(request({ token, body }), {}, NOW)).resolves.toBeNull();
  });

  it("rejects a body without a draft id", async () => {
    for (const bad of ["", "not json", JSON.stringify({}), JSON.stringify({ draftId: -1 }), JSON.stringify({ draftId: "x" })]) {
      await expect(readDraftJobRequest(request({ token, body: bad }), env, NOW)).resolves.toBeNull();
    }
  });
});
