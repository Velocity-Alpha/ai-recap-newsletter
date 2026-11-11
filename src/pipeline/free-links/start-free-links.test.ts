import { describe, expect, it, vi } from "vitest";

import { FREE_LINKS_BACKGROUND_PATH, readFreeLinksJobRequest, readStoryIds, startFreeLinksJob } from "@/src/pipeline/free-links/start-free-links";
import { createJobToken } from "@/src/server/job-token";

const ENV = { SESSION_SECRET: "test-session-secret" };
const NOW = new Date("2026-11-10T12:00:00Z");
const SITE = { siteUrl: "https://site.example/" };

function jobRequest(storyIds: unknown, token: string | null, method = "POST") {
  return new Request(`https://site.example${FREE_LINKS_BACKGROUND_PATH}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: method === "POST" ? JSON.stringify({ storyIds }) : undefined,
  });
}

describe("readStoryIds", () => {
  it("gives the ids, each once", () => {
    expect(readStoryIds([3, 1, 3])).toEqual([3, 1]);
  });

  it("gives null for a value that is not a list of whole positive numbers", () => {
    for (const value of [undefined, "1,2", [1, "2"], [0], [-1], [1.5]]) expect(readStoryIds(value)).toBeNull();
  });

  it("gives null for more than 60 ids", () => {
    expect(readStoryIds(Array.from({ length: 61 }, (_, index) => index + 1))).toBeNull();
    expect(readStoryIds(Array.from({ length: 60 }, (_, index) => index + 1))).toHaveLength(60);
  });
});

describe("startFreeLinksJob", () => {
  it("calls the background function with the story ids and a job token the function accepts", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 202 }));

    const result = await startFreeLinksJob([4, 9], SITE, { env: ENV, now: () => NOW, fetch });

    expect(result).toEqual({ status: "started" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://site.example/.netlify/functions/find-free-links-background");
    expect(init?.redirect).toBe("error");
    const sent = new Request(String(url), { method: "POST", headers: init?.headers, body: init?.body });
    await expect(readFreeLinksJobRequest(sent, ENV, NOW)).resolves.toEqual([4, 9]);
  });

  it("does not call when the session secret is missing", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>();

    const result = await startFreeLinksJob([4], SITE, { env: {}, fetch });

    expect(result).toEqual({ status: "not_configured", reason: "Missing setting: SESSION_SECRET." });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("throws when the function refuses the call", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 500 }));

    await expect(startFreeLinksJob([4], SITE, { env: ENV, now: () => NOW, fetch })).rejects.toThrow("Starting the free links job failed with HTTP 500.");
  });
});

describe("readFreeLinksJobRequest", () => {
  const token = (ids: number[]) => createJobToken("find-free-links", ENV.SESSION_SECRET, NOW, ids.join(","));

  it("refuses a request with no token", async () => {
    await expect(readFreeLinksJobRequest(jobRequest([4, 9], null), ENV, NOW)).resolves.toBeNull();
  });

  it("refuses a token that was signed for other story ids", async () => {
    await expect(readFreeLinksJobRequest(jobRequest([4, 10], token([4, 9])), ENV, NOW)).resolves.toBeNull();
  });

  it("refuses a token of another job", async () => {
    const draftToken = createJobToken("draft-issue", ENV.SESSION_SECRET, NOW, "4,9");

    await expect(readFreeLinksJobRequest(jobRequest([4, 9], draftToken), ENV, NOW)).resolves.toBeNull();
  });

  it("refuses an expired token", async () => {
    const later = new Date(NOW.getTime() + 10 * 60_000);

    await expect(readFreeLinksJobRequest(jobRequest([4, 9], token([4, 9])), ENV, later)).resolves.toBeNull();
  });

  it("refuses a request that is not a POST, or has no story ids", async () => {
    await expect(readFreeLinksJobRequest(jobRequest([4], token([4]), "GET"), ENV, NOW)).resolves.toBeNull();
    await expect(readFreeLinksJobRequest(jobRequest([], token([])), ENV, NOW)).resolves.toBeNull();
  });
});
