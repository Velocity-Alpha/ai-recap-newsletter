import { describe, expect, it, vi } from "vitest";

import { createSiteRefresher, siteUrlForDeploy } from "@/src/pipeline/publish/site-refresh";
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

  it("throws with the status when the site answers with an error", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 401 }));
    const refresh = createSiteRefresher({ siteUrl: "https://airecap.news", secret: "s3cret", fetch, now: () => NOW });

    await expect(refresh?.()).rejects.toThrow("Site refresh failed with HTTP 401.");
  });

  it("is not configured without a secret or a site address", () => {
    expect(createSiteRefresher({ siteUrl: "https://airecap.news", secret: undefined })).toBeUndefined();
    expect(createSiteRefresher({ siteUrl: "https://airecap.news", secret: "  " })).toBeUndefined();
    expect(createSiteRefresher({ siteUrl: "", secret: "s3cret" })).toBeUndefined();
  });
});
