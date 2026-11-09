import { describe, expect, it, vi } from "vitest";

import { isAuthorizedIngestRequest, startIngestJob } from "@/src/pipeline/ingest/start-ingest";
import { createJobToken } from "@/src/server/job-token";

const SECRET = "s".repeat(32);
const NINE_FIFTY_FIVE = new Date("2026-11-10T14:55:00Z"); // Tue 09:55 New York
const EIGHT_FIFTY_FIVE = new Date("2026-11-10T13:55:00Z"); // Tue 08:55 New York
const PUBLISHED = { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "d1", published: true } };
const PREVIEW = { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "abc123", published: false } };

function accepted() {
  return vi.fn<typeof fetch>(async () => new Response(null, { status: 202 }));
}

describe("startIngestJob", () => {
  it("starts the background function with a signed token at 09:55 New York in production", async () => {
    const fetch = accepted();
    const result = await startIngestJob(PUBLISHED, {
      env: { APP_ENV: "production", SESSION_SECRET: SECRET },
      now: () => NINE_FIFTY_FIVE,
      fetch,
    });

    expect(result).toEqual({ status: "started" });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://airecap.news/.netlify/functions/ingest-stories-background");
    expect(init?.method).toBe("POST");
    const request = new Request(url, init);
    expect(isAuthorizedIngestRequest(request, { SESSION_SECRET: SECRET }, NINE_FIFTY_FIVE)).toBe(true);
  });

  it("skips the other UTC slot in production", async () => {
    const fetch = accepted();
    const result = await startIngestJob(PUBLISHED, {
      env: { APP_ENV: "production", SESSION_SECRET: SECRET },
      now: () => EIGHT_FIFTY_FIVE,
      fetch,
    });

    expect(result).toEqual({ status: "not_time" });
    expect(fetch).not.toHaveBeenCalled();
  });

  // Previews have no schedule. They run only with "Run now", at any time, against the dev database.
  it("runs at any time on a preview, and calls the preview's own address", async () => {
    const fetch = accepted();
    const result = await startIngestJob(PREVIEW, {
      env: { APP_ENV: "preview", SESSION_SECRET: SECRET },
      now: () => EIGHT_FIFTY_FIVE,
      fetch,
    });

    expect(result).toEqual({ status: "started" });
    expect(fetch.mock.calls[0][0]).toBe("https://abc123--ai-recap.netlify.app/.netlify/functions/ingest-stories-background");
  });

  it("names a missing secret", async () => {
    const result = await startIngestJob(PREVIEW, { env: { APP_ENV: "preview" }, now: () => NINE_FIFTY_FIVE, fetch: accepted() });
    expect(result).toEqual({ status: "not_configured", reason: "Missing setting: SESSION_SECRET." });
  });

  it("fails when the background function does not accept the job", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 404 }));
    await expect(
      startIngestJob(PREVIEW, { env: { APP_ENV: "preview", SESSION_SECRET: SECRET }, now: () => NINE_FIFTY_FIVE, fetch }),
    ).rejects.toThrow("Starting the ingest job failed with HTTP 404.");
  });
});

describe("isAuthorizedIngestRequest", () => {
  const url = "https://airecap.news/.netlify/functions/ingest-stories-background";

  it("rejects a missing token, a token for another purpose, and a GET", () => {
    const env = { SESSION_SECRET: SECRET };
    const cacheToken = createJobToken("cache-refresh", SECRET, NINE_FIFTY_FIVE);
    const ingestToken = createJobToken("ingest-stories", SECRET, NINE_FIFTY_FIVE);

    expect(isAuthorizedIngestRequest(new Request(url, { method: "POST" }), env, NINE_FIFTY_FIVE)).toBe(false);
    expect(
      isAuthorizedIngestRequest(
        new Request(url, { method: "POST", headers: { authorization: `Bearer ${cacheToken}` } }),
        env,
        NINE_FIFTY_FIVE,
      ),
    ).toBe(false);
    expect(
      isAuthorizedIngestRequest(new Request(url, { headers: { authorization: `Bearer ${ingestToken}` } }), env, NINE_FIFTY_FIVE),
    ).toBe(false);
  });

  it("rejects every request when SESSION_SECRET is missing", () => {
    const token = createJobToken("ingest-stories", "", NINE_FIFTY_FIVE);
    const request = new Request(url, { method: "POST", headers: { authorization: `Bearer ${token}` } });
    expect(isAuthorizedIngestRequest(request, {}, NINE_FIFTY_FIVE)).toBe(false);
  });
});
