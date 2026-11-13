import { describe, expect, it } from "vitest";

import { buildPage, type PageStory } from "@/evals/section-scoring/page";

/** A story row as the build script reads it: with the fields the page must not show. */
const rows = [
  {
    id: 101,
    inputHash: "aaa",
    headline: "OpenAI ships a <new> model",
    summary: "It is faster & cheaper.",
    source: "tldr",
    url: "https://example.com/a",
    recommendation: { kind: "general" as const, importance: 4 },
    category: "zz-extraction-category",
    importance_score: 9876,
    used_in_publication_date: "2099-01-02",
    section: "zz-published-section",
  },
  {
    id: 102,
    inputHash: "bbb",
    headline: "A new benchmark for agents",
    summary: "Researchers test 40 agents.",
    source: "huggingface",
    url: null,
    recommendation: null,
    category: "zz-extraction-category",
    importance_score: 9876,
    used_in_publication_date: "2099-01-02",
    section: "zz-published-section",
  },
];

const page = buildPage({
  batch: "tuning-1",
  scoringVersion: "7ca6fcd6",
  stories: rows as PageStory[],
  levels: [{ label: "1", description: "Opinion." }],
  script: "/* label logic */",
});

describe("buildPage", () => {
  it("holds every story of the batch", () => {
    for (const row of rows) {
      expect(page).toContain(`"id":${row.id}`);
      expect(page).toContain(row.inputHash);
    }
    expect(page).toContain("A new benchmark for agents");
    expect(page).toContain('"recommendation":null');
  });

  it("holds none of the hidden fields: past action, extraction category, extraction importance", () => {
    for (const hidden of ["zz-extraction-category", "9876", "2099-01-02", "zz-published-section", "importance_score", "category"]) {
      expect(page).not.toContain(hidden);
    }
  });

  it("escapes story text so it cannot close the script tag", () => {
    expect(page).not.toContain("<new>");
    const withScript = buildPage({
      batch: "tuning-1",
      scoringVersion: "x",
      stories: [{ ...rows[0], headline: "</script><b>x</b>" } as PageStory],
      levels: [],
      script: "",
    });
    expect(withScript).not.toContain("</script><b>");
  });

  it("loads the label logic and names the batch", () => {
    expect(page).toContain("/* label logic */");
    expect(page).toContain("tuning-1");
  });
});
