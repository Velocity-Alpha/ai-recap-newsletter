import { describe, expect, it, vi } from "vitest";

import { resolveTrackingLinks } from "@/src/pipeline/ingest/redirects";

const TLDR = /https:\/\/links\.tldrnewsletter\.com\/[A-Za-z0-9]+/gi;

function redirect(location: string, status = 302): Response {
  return new Response(null, { status, headers: { location } });
}

function fakeFetch(routes: Record<string, () => Response>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe("manual");
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    const route = routes[href];
    if (!route) throw new Error(`Unexpected request ${href}`);
    return route();
  });
}

describe("resolveTrackingLinks", () => {
  it("replaces each tracking link with where it finally leads, following several hops", async () => {
    const fetch = fakeFetch({
      "https://links.tldrnewsletter.com/abc": () => redirect("https://t.co/xyz"),
      "https://t.co/xyz": () => redirect("/final?utm_source=tldr", 301),
      "https://t.co/final?utm_source=tldr": () => new Response("<html>article</html>", { status: 200 }),
      "https://links.tldrnewsletter.com/def": () => redirect("https://openai.com/index/lifeval/"),
      "https://openai.com/index/lifeval/": () => new Response("ok", { status: 200 }),
    });

    const text = "Read https://links.tldrnewsletter.com/abc and https://links.tldrnewsletter.com/def, again https://links.tldrnewsletter.com/abc.";
    await expect(resolveTrackingLinks(text, TLDR, { fetch })).resolves.toBe(
      "Read https://t.co/final?utm_source=tldr and https://openai.com/index/lifeval/, again https://t.co/final?utm_source=tldr.",
    );
    // Each unique link is resolved once.
    expect(fetch.mock.calls.filter(([url]) => url === "https://links.tldrnewsletter.com/abc")).toHaveLength(1);
  });

  it("keeps the original link when it does not redirect or the request fails, never the page body", async () => {
    const fetch = fakeFetch({
      "https://links.tldrnewsletter.com/page": () => new Response("<html>a page</html>", { status: 200 }),
      "https://links.tldrnewsletter.com/down": () => {
        throw new Error("ETIMEDOUT");
      },
    });

    const text = "A https://links.tldrnewsletter.com/page B https://links.tldrnewsletter.com/down";
    await expect(resolveTrackingLinks(text, TLDR, { fetch })).resolves.toBe(text);
  });

  it("stops after 5 hops and uses the last address it reached", async () => {
    const routes: Record<string, () => Response> = {
      "https://links.tldrnewsletter.com/loop": () => redirect("https://a.example/1"),
    };
    for (let hop = 1; hop <= 10; hop += 1) routes[`https://a.example/${hop}`] = () => redirect(`https://a.example/${hop + 1}`);
    const fetch = fakeFetch(routes);

    await expect(resolveTrackingLinks("https://links.tldrnewsletter.com/loop", TLDR, { fetch })).resolves.toBe(
      "https://a.example/5",
    );
    expect(fetch).toHaveBeenCalledTimes(5);
  });

  it("decodes HTML entities in a link before requesting it", async () => {
    const pattern = /https:\/\/app\.alphasignal\.ai\/c\?[^"'<> \t\r\n]+/gi;
    const fetch = fakeFetch({
      "https://app.alphasignal.ai/c?uid=1&cid=2": () => redirect("https://github.com/org/repo"),
    });

    await expect(
      resolveTrackingLinks('<a href="https://app.alphasignal.ai/c?uid=1&amp;cid=2">repo</a>', pattern, { fetch }),
    ).resolves.toBe('<a href="https://github.com/org/repo">repo</a>');
  });

  it("returns the text unchanged when there is no tracking link", async () => {
    const fetch = vi.fn();
    await expect(resolveTrackingLinks("no links here", TLDR, { fetch })).resolves.toBe("no links here");
    expect(fetch).not.toHaveBeenCalled();
  });
});
