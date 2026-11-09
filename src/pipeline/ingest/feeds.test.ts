import { describe, expect, it } from "vitest";

import { buildHuggingFaceText, buildProductHuntText } from "@/src/pipeline/ingest/feeds";

function entry(id: number, title: string, published: string, slug: string, tagline: string): string {
  return `<entry>
    <id>tag:www.producthunt.com,2005:Post/${id}</id>
    <published>${published}</published>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/${slug}"/>
    <title>${title}</title>
    <content type="html">&lt;p&gt;
            ${tagline}
          &lt;/p&gt;
          &lt;p&gt;&lt;a href="https://www.producthunt.com/products/${slug}?utm_campaign=feed"&gt;Discussion&lt;/a&gt;&lt;/p&gt;</content>
    <author><name>Maker ${id}</name></author>
  </entry>`;
}

const FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
  ${entry(1, "Gadget One", "2026-11-08T09:00:00-08:00", "gadget-one", "Turns notes into plans &amp;amp; tasks")}
  ${entry(2, "Old Thing", "2026-11-01T09:00:00-08:00", "old-thing", "Too old for the window")}
  ${entry(3, "Gadget Two", "2026-11-07T21:06:31-08:00", "gadget-two", "Second tool")}
  ${entry(4, "Gadget One Again", "2026-11-08T10:00:00-08:00", "gadget-one", "Same product link")}
  ${entry(5, "Future", "2026-11-09T23:00:00-08:00", "future", "Not published yet")}
</feed>`;

describe("buildProductHuntText", () => {
  it("lists products published in the window, without repeats, in feed order", () => {
    const result = buildProductHuntText(FEED, {
      cutoff: new Date("2026-11-06T14:55:00Z"),
      now: new Date("2026-11-09T14:55:00Z"),
      targetDate: "2026-11-09",
    });

    expect(result.count).toBe(2);
    expect(result.text).toBe(
      [
        "Source: Product Hunt AI category feed",
        "",
        "Target date: 2026-11-09",
        "",
        "## Product 1",
        "Name: Gadget One",
        "Tagline: Turns notes into plans & tasks",
        "Product Hunt URL: https://www.producthunt.com/products/gadget-one",
        "Published at: 2026-11-08",
        "",
        "## Product 2",
        "Name: Gadget Two",
        "Tagline: Second tool",
        "Product Hunt URL: https://www.producthunt.com/products/gadget-two",
        "Published at: 2026-11-08",
      ].join("\n"),
    );
  });

  it("keeps at most 12 products", () => {
    const many = Array.from({ length: 15 }, (_, index) =>
      entry(index, `P${index}`, "2026-11-08T09:00:00-08:00", `p-${index}`, "x"),
    ).join("");
    const result = buildProductHuntText(`<feed>${many}</feed>`, {
      cutoff: new Date("2026-11-06T00:00:00Z"),
      now: new Date("2026-11-09T00:00:00Z"),
      targetDate: "2026-11-09",
    });
    expect(result.count).toBe(12);
  });

  it("returns no products for an empty or broken feed", () => {
    expect(buildProductHuntText("<html>blocked</html>", { cutoff: new Date(0), now: new Date(), targetDate: "2026-11-09" }).count).toBe(0);
  });
});

function papersPage(papers: unknown[]): string {
  const props = JSON.stringify({ dateString: "2026-11-09", dailyPapers: papers });
  const escaped = props.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return `<html><body><div data-target="DailyPapers" data-props="${escaped}"></div></body></html>`;
}

function paper(id: string, title: string, daily: string, upvotes = 1) {
  return {
    publishedAt: "2026-11-04T19:00:00.000Z",
    title,
    summary: `${title} abstract & details`,
    paper: {
      id,
      title,
      summary: `${title} abstract & details`,
      ai_summary: `${title} in one line`,
      submittedOnDailyAt: daily,
      upvotes,
      authors: [{ name: "A. Author" }, { name: "B. Author" }],
      githubRepo: "https://github.com/org/repo",
    },
    organization: { fullname: "Example Lab" },
  };
}

describe("buildHuggingFaceText", () => {
  it("lists the first 5 papers added to the daily list after the cutoff", () => {
    const page = papersPage([
      paper("2611.00001", "Paper A", "2026-11-09T00:00:00.000Z", 9),
      paper("2611.00002", "Paper B", "2026-11-06T00:00:00.000Z"),
      ...["C", "D", "E", "F", "G"].map((letter, index) =>
        paper(`2611.0001${index}`, `Paper ${letter}`, "2026-11-09T00:00:00.000Z"),
      ),
    ]);

    const result = buildHuggingFaceText(page, { cutoff: new Date("2026-11-06T14:55:00Z"), targetDate: "2026-11-09" });

    expect(result.count).toBe(5);
    expect(result.text).toContain("## Paper 1\nTitle: Paper A\nURL: https://huggingface.co/papers/2611.00001");
    expect(result.text).toContain("Organization: Example Lab");
    expect(result.text).toContain("Authors: A. Author, B. Author");
    expect(result.text).toContain("Abstract: Paper A abstract & details");
    expect(result.text).not.toContain("Paper B");
    expect(result.text).not.toContain("Paper G");
  });

  it("throws a clear error when the page has no paper list", () => {
    expect(() => buildHuggingFaceText("<html></html>", { cutoff: new Date(0), targetDate: "2026-11-09" })).toThrow(
      "Hugging Face page has no daily paper list.",
    );
  });
});
