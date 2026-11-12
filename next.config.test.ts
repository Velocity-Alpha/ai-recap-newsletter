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
