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
    expect(matchesPage.test("3")).toBe(true);
    expect(matchesPage.test("abc")).toBe(false);
    expect(matchesPage.test("")).toBe(false);
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
