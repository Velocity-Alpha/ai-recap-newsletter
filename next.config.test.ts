import { describe, expect, it, vi } from "vitest";

async function loadRedirects() {
  vi.stubEnv("APP_ENV", "development");
  const { default: nextConfig } = await import("./next.config.mjs");
  return (await nextConfig.redirects?.()) ?? [];
}

describe("old archive links", () => {
  it("send /archive?page=N to /archive/page/N", async () => {
    const redirects = await loadRedirects();
    const rule = redirects.find((redirect) => redirect.source === "/archive");

    expect(rule).toMatchObject({ destination: "/archive/page/:page", permanent: true });

    const [pageQuery] = rule?.has ?? [];
    expect(pageQuery).toMatchObject({ type: "query", key: "page" });

    const matchesPage = new RegExp(`^(?:${(pageQuery as { value: string }).value})$`);
    expect(matchesPage.test("2")).toBe(true);
    expect(matchesPage.test("3")).toBe(true);
    expect(matchesPage.test("10")).toBe(true);
    expect(matchesPage.test("abc")).toBe(false);
    expect(matchesPage.test("")).toBe(false);
  });

  // /archive/page/1 redirects to /archive and both redirects carry the query, so a rule that matched page 1 would
  // send /archive?page=1 round in a loop. Page 1 (and 0 or leading zeros) just serves /archive.
  it("leave /archive?page=1, 0 and leading zeros on /archive, so no redirect loop", async () => {
    const redirects = await loadRedirects();
    const rule = redirects.find((redirect) => redirect.source === "/archive");
    const [pageQuery] = rule?.has ?? [];
    const matchesPage = new RegExp(`^(?:${(pageQuery as { value: string }).value})$`);

    for (const value of ["1", "0", "01", "02", "00"]) {
      expect(matchesPage.test(value), value).toBe(false);
    }
  });
});

describe("archive cache key", () => {
  // Netlify's cache ignores query values unless the response asks for them. Without `page` in the key, a cached
  // /archive answers /archive?page=N before the redirect above can run.
  it("keeps the page query value in the Netlify cache key for /archive", async () => {
    vi.stubEnv("APP_ENV", "development");
    const { default: nextConfig } = await import("./next.config.mjs");
    const headers = (await nextConfig.headers?.()) ?? [];
    const rule = headers.find((header) => header.source === "/archive");

    expect(rule?.headers).toContainEqual({ key: "Netlify-Vary", value: "query=page" });
  });
});
