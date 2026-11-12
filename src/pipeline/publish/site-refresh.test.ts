import { describe, expect, it, vi } from "vitest";

import { createSiteRefresher, siteUrlForDeploy, warmPages } from "@/src/pipeline/publish/site-refresh";
import { isValidCacheRefreshToken } from "@/src/server/cache-refresh-auth";

const NOW = new Date("2026-11-09T16:00:00.000Z");

describe("siteUrlForDeploy", () => {
  const site = { url: "https://airecap.news", name: "ai-recap" };

  it("uses the main site address for the published deploy", () => {
    expect(siteUrlForDeploy({ site, deploy: { id: "abc123", published: true } })).toBe("https://airecap.news");
  });

  it("uses the deploy's own address for a preview, so a preview never refreshes production", () => {
    expect(siteUrlForDeploy({ site, deploy: { id: "abc123", published: false } })).toBe(
      "https://abc123--ai-recap.netlify.app",
    );
  });
});

describe("createSiteRefresher", () => {
  it("posts a short-lived signed token to the site's revalidate route", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news/", secret: "s3cret", fetch, now: () => NOW });

    await refresh?.();

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://airecap.news/api/revalidate");
    expect(init.method).toBe("POST");
    const authorization = new Headers(init.headers).get("authorization") ?? "";
    expect(authorization.startsWith("Bearer ")).toBe(true);
    expect(isValidCacheRefreshToken(authorization.slice("Bearer ".length), "s3cret", NOW)).toBe(true);
    expect(authorization).not.toContain("s3cret");
  });

  it("after the refresh, loads each page the site returns, one after another, and reports them", async () => {
    const calls: string[] = [];
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("/api/revalidate")) {
        return Response.json({ refreshed: ["published-issues"], warm: ["/", "/archive", "/issue/ai-recap-2026-11-12"] });
      }
      return new Response("<html></html>", { status: 200 });
    });
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news/", secret: "s3cret", fetch, now: () => NOW });

    const report = await refresh?.();

    expect(calls).toEqual([
      "https://airecap.news/api/revalidate",
      "https://airecap.news/",
      "https://airecap.news/archive",
      "https://airecap.news/issue/ai-recap-2026-11-12",
    ]);
    const pageLoad = fetch.mock.calls[1] as unknown as [string, RequestInit];
    expect(pageLoad[1].method ?? "GET").toBe("GET");
    expect(new Headers(pageLoad[1].headers).get("authorization")).toBeNull();
    expect(report).toEqual({ warmed: ["/", "/archive", "/issue/ai-recap-2026-11-12"], failed: [] });
  });

  it("reports a page that fails to load and still loads the rest", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/api/revalidate")) return Response.json({ warm: ["/", "/archive", "/issue/x"] });
      if (url.endsWith("/archive")) return new Response("", { status: 500 });
      if (url.endsWith("/issue/x")) throw new Error("The operation was aborted due to timeout");
      return new Response("ok", { status: 200 });
    });
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news", secret: "s3cret", fetch, now: () => NOW });

    const report = await refresh?.();

    expect(report).toEqual({
      warmed: ["/"],
      failed: [
        { path: "/archive", reason: "HTTP 500" },
        { path: "/issue/x", reason: "The operation was aborted due to timeout" },
      ],
    });
  });

  it("warms nothing when the site returns no pages to warm", async () => {
    const fetch = vi.fn(async () => Response.json({ refreshed: ["published-issues"] }));
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news", secret: "s3cret", fetch, now: () => NOW });

    expect(await refresh?.()).toEqual({ warmed: [], failed: [] });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("throws with the status when the site answers with an error, and loads no pages", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news", secret: "s3cret", fetch, now: () => NOW });

    await expect(refresh?.()).rejects.toThrow("Site refresh failed with HTTP 401.");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("is not configured without a secret or a site address", () => {
    expect(createSiteRefresher({ siteUrl: "https://airecap.news", secret: undefined })).toBeUndefined();
    expect(createSiteRefresher({ siteUrl: "https://airecap.news", secret: "  " })).toBeUndefined();
    expect(createSiteRefresher({ siteUrl: "", secret: "s3cret" })).toBeUndefined();
  });
});

describe("warmPages", () => {
  it("asks for Brotli or gzip like a browser, so it fills the cached copy browsers read", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response("ok"));

    await warmPages("https://site.example/", ["/"], { fetch: fetchMock as unknown as typeof fetch });

    const headers = new Headers(fetchMock.mock.calls[0]?.[1]?.headers);
    expect(headers.get("accept-encoding")).toBe("br, gzip");
  });
});
