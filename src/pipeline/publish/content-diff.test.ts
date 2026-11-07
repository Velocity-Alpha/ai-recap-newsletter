import { describe, expect, it } from "vitest";

import { diffIssueContent } from "@/src/pipeline/publish/content-diff";

const BASE = {
  schemaVersion: 2,
  title: "Genie Goes Live",
  issue_id: 264,
  overview: { summary: "Good morning." },
  headlines: [{ story_id: 11, headline: "A", bullets: [{ before: "x", highlight: "y", after: "z" }] }],
  tools: [],
};

describe("diffIssueContent", () => {
  it("finds no differences between equal content", () => {
    expect(diffIssueContent(BASE, structuredClone(BASE))).toEqual([]);
  });

  it("ignores curly quotes, extra spaces, and story ids stored as strings", () => {
    const native = { ...structuredClone(BASE), title: "Genie’s “Live” Day" };
    const n8n = {
      ...structuredClone(BASE),
      title: ` Genie's  "Live" Day `,
      overview: { summary: "Good  morning." },
      headlines: [{ story_id: "11", headline: "A", bullets: [{ before: "x", highlight: "y", after: "z" }] }],
    };

    expect(diffIssueContent(native, n8n)).toEqual([]);
  });

  it("lists changed values, list lengths, and missing keys by path", () => {
    const other = structuredClone(BASE) as Record<string, unknown>;
    (other.headlines as Array<Record<string, unknown>>)[0].headline = "B";
    other.tools = [{ story_id: 5 }];
    delete other.overview;

    expect(diffIssueContent(BASE, other)).toEqual([
      'overview: native={"summary":"Good morning."} published=undefined',
      'headlines[0].headline: native="A" published="B"',
      "tools: native has 0 items, published has 1",
    ]);
  });
});
