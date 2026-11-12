import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { describeWarmUp, warmDeploy } from "@/src/pipeline/publish/deploy-warm-up";

const PATHS = ["/", "/archive", "/issue/ai-recap-2026-11-12"];

function okFetch() {
  return vi.fn<typeof fetch>(async () => new Response("<html></html>", { status: 200 }));
}

function event(payload: Record<string, unknown>) {
  return new Request("https://ai-recap.netlify.app/.netlify/functions/deploy-succeeded", {
    method: "POST",
    body: JSON.stringify({ payload }),
  });
}

describe("warmDeploy", () => {
  it("loads the main site's pages in order after a production deploy", async () => {
    const fetch = okFetch();

    const report = await warmDeploy(
      event({ id: "abc123", name: "ai-recap", ssl_url: "https://airecap.news", context: "production" }),
      undefined,
      { fetch, readPaths: async () => PATHS },
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      "https://airecap.news/",
      "https://airecap.news/archive",
      "https://airecap.news/issue/ai-recap-2026-11-12",
    ]);
    expect(report).toEqual({ warmed: PATHS, failed: [] });
  });

  it("loads only the preview's own pages after a preview deploy", async () => {
    const fetch = okFetch();

    await warmDeploy(
      event({ id: "abc123", name: "ai-recap", ssl_url: "https://airecap.news", context: "deploy-preview" }),
      undefined,
      { fetch, readPaths: async () => ["/"] },
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://abc123--ai-recap.netlify.app/"]);
  });

  it("uses the function's own deploy when the event has no deploy", async () => {
    const fetch = okFetch();
    const request = new Request("https://example.test/", { method: "POST", body: "not json" });

    await warmDeploy(
      request,
      { site: { url: "https://airecap.news", name: "ai-recap" }, deploy: { id: "def456", published: false } },
      { fetch, readPaths: async () => ["/"] },
    );

    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["https://def456--ai-recap.netlify.app/"]);
  });

  it("loads nothing when it cannot tell the deploy's address", async () => {
    const fetch = okFetch();

    const report = await warmDeploy(event({}), undefined, { fetch, readPaths: async () => PATHS });

    expect(fetch).not.toHaveBeenCalled();
    expect(report).toBeUndefined();
  });
});

describe("describeWarmUp", () => {
  it("names the pages that loaded and the ones that failed", () => {
    expect(describeWarmUp({ warmed: ["/"], failed: [{ path: "/archive", reason: "HTTP 500" }] })).toBe(
      "Loaded 1 of 2 pages. Failed: /archive (HTTP 500).",
    );
    expect(describeWarmUp({ warmed: ["/", "/archive"], failed: [] })).toBe("Loaded 2 of 2 pages.");
    expect(describeWarmUp(undefined)).toBe("No deploy address, so no pages were loaded.");
  });
});
