import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { describeDeployWarmUp, warmDeploy } from "@/src/pipeline/publish/deploy-warm-up";

const PATHS = ["/", "/archive", "/issue/ai-recap-2026-11-12"];

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response("<html></html>", { status: 200 }));
}

// Netlify posts `{ payload: <the deploy> }` to a function named after the event (docs: "Trigger functions on
// events", legacy filename convention). The deploy uses the Netlify API's snake_case field names.
function event(payload: Record<string, unknown>) {
  return new Request("https://ai-recap.netlify.app/.netlify/functions/deploy-succeeded", {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

const PUBLISHED_PRODUCTION = {
  id: "abc123",
  name: "ai-recap",
  ssl_url: "https://airecap.news",
  context: "production",
  published_at: "2026-11-12T15:00:00.000Z",
};

describe("warmDeploy", () => {
  it("loads the main site's pages in order after a published production deploy", async () => {
    const fetch = okFetch();

    const warmUp = await warmDeploy(event(PUBLISHED_PRODUCTION), undefined, { fetch, readPaths: async () => PATHS });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://airecap.news/",
      "https://airecap.news/archive",
      "https://airecap.news/issue/ai-recap-2026-11-12",
    ]);
    expect(warmUp).toEqual({
      siteUrl: "https://airecap.news",
      source: "deploy event",
      report: { warmed: PATHS, failed: [], cacheStatus: {} },
    });
  });

  it("loads only the deploy's own address when a production deploy was not published (production is locked)", async () => {
    const fetch = okFetch();

    await warmDeploy(event({ ...PUBLISHED_PRODUCTION, published_at: null }), undefined, {
      fetch,
      readPaths: async () => ["/"],
    });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://abc123--ai-recap.netlify.app/"]);
  });

  it("loads only the preview's own pages after a preview deploy", async () => {
    const fetch = okFetch();

    await warmDeploy(event({ ...PUBLISHED_PRODUCTION, context: "deploy-preview", published_at: null }), undefined, {
      fetch,
      readPaths: async () => ["/"],
    });

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://abc123--ai-recap.netlify.app/"]);
  });

  it("uses the function's own deploy when the event has no deploy, and says so", async () => {
    const fetch = okFetch();
    const request = new Request("https://example.test/", { method: "POST", body: "not json" });

    const warmUp = await warmDeploy(
      request,
      { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "def456", published: false } },
      { fetch, readPaths: async () => ["/"] },
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://def456--ai-recap.netlify.app/"]);
    expect(warmUp?.source).toBe("function context");
  });

  it("loads nothing when it cannot tell the deploy's address", async () => {
    const fetch = okFetch();

    const warmUp = await warmDeploy(event({}), undefined, { fetch, readPaths: async () => PATHS });

    expect(fetch).not.toHaveBeenCalled();
    expect(warmUp).toBeUndefined();
  });
});

describe("describeDeployWarmUp", () => {
  it("names the address, where it came from, and the pages", () => {
    expect(
      describeDeployWarmUp({
        siteUrl: "https://airecap.news",
        source: "deploy event",
        report: { warmed: ["/"], failed: [{ path: "/archive", reason: "HTTP 500" }] },
      }),
    ).toEqual({
      level: "warn",
      message:
        "https://airecap.news (address from the deploy event): Loaded 1 of 2 pages for the cache. Could not load /archive (HTTP 500). " +
        "The first reader of those pages waits for a fresh render.",
    });
  });

  it("says when there was no deploy address", () => {
    expect(describeDeployWarmUp(undefined)).toEqual({
      level: "warn",
      message: "No deploy address, so no pages were loaded.",
    });
  });
});
