import { describe, expect, it } from "vitest";

import { issueText, readManifest, spreadPick } from "@/evals/extraction/dataset";

// Made-up pages: no third-party text in tests.
const page = (inner: string) => `<html><head><title>x</title></head><body><nav>Menu</nav>${inner}<footer>Footer</footer></body></html>`;

describe("issueText", () => {
  it("reads only the issue's content element, with links as Markdown", () => {
    expect(issueText("tldr_web", page('<div class="content-center max-w-xl"><h3><a href="https://a.example/x">Acme ships</a></h3><p>Body.</p></div>'))).toBe(
      "[Acme ships](https://a.example/x)\n\nBody."
    );
    expect(issueText("rundown_web", page('<div class="rendered-post"><p>Rundown body</p></div>'))).toBe("Rundown body");
    expect(issueText("substack", page('<div class="available-content"><p>Signal body</p></div>'))).toBe("Signal body");
    expect(issueText("beehiiv", page('<div id="content-blocks"><p>Beehiiv body</p></div>'))).toBe("Beehiiv body");
  });

  it("fails when the page has no content element", () => {
    expect(() => issueText("tldr_web", page("<p>no issue</p>"))).toThrow("div.content-center");
  });
});

describe("spreadPick", () => {
  const days = Array.from({ length: 10 }, (_, index) => ({ date: `2026-10-${String(index + 10)}` }));
  const key = (item: { date: string }) => item.date;

  it("spreads the picks over the candidates, by date", () => {
    expect(spreadPick(days, [], 2, key).map(key)).toEqual(["2026-10-12", "2026-10-17"]);
  });

  it("keeps the kept items and counts them toward the total", () => {
    expect(spreadPick(days, [{ date: "2026-10-10" }], 2, key).map(key)).toEqual(["2026-10-10", "2026-10-15"]);
  });

  it("takes every candidate when there are too few", () => {
    expect(spreadPick(days.slice(0, 3), [], 5, key)).toHaveLength(3);
  });
});

describe("manifest", () => {
  it("lists issues with unique ids, a date, a public url and a known format", () => {
    const issues = readManifest();
    expect(issues.length).toBeGreaterThanOrEqual(50);
    expect(new Set(issues.map((issue) => issue.id)).size).toBe(issues.length);
    for (const issue of issues) {
      expect(issue.date).toMatch(/^2026-(09|1[01])-\d{2}$/);
      expect(issue.url).toMatch(/^https:\/\//);
      expect(["tldr_web", "rundown_web", "beehiiv", "substack"]).toContain(issue.format);
    }
  });
});
