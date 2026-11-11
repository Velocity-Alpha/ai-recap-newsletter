import { describe, expect, it } from "vitest";

import type { ExtractionGolden } from "@/evals/extraction/golden";
import type { ExtractionGrade, StoryVerdict } from "@/evals/extraction/judge";
import { checkExtraction, foundGolden, linkedStoryUrls, scoreExtraction, urlsInText, type ExtractionOutput, type ScoredIssue } from "@/evals/extraction/score";
import type { Outcome } from "@/evals/lib/sweep";
import { outcomeOf } from "@/evals/lib/testing";
import type { ExtractedStory } from "@/src/pipeline/ingest/extract";

// Made-up text and stories: no third-party text in tests.
const TEXT = [
  "[Acme Ships Model](https://acme.example/model?utm_source=news) Acme released a model.",
  "Quick links: [Beta raises $10M](https://beta.example/raise). See https://news.example/p/issue for more.",
].join("\n");

const story = (url: string, extra: Partial<ExtractedStory> = {}): ExtractedStory => ({
  category: "Launches",
  headline: `Story ${url}`,
  summary: "s",
  story_detail: "d",
  published_at: "2026-11-09",
  url,
  importance_score: 3,
  ...extra,
});

const verdict = (index: number, extra: Partial<StoryVerdict> = {}): StoryVerdict => ({
  index,
  kind: "story",
  golden: [index],
  unsupported_facts: 0,
  headline_ok: true,
  ...extra,
});

// Fake golden: 3 stories (the third a roundup) and one item to leave out.
const GOLDEN: ExtractionGolden = {
  stories: [
    { label: "Acme ships a model", url: "https://acme.example/model", category: "Launches", importance: 3 },
    { label: "Beta raises ten million", url: "https://beta.example/raise", category: "Funding", importance: 2 },
    { label: "Tools list", url: "", category: "Tools", importance: 2, roundup: true },
  ],
  excluded: [{ label: "Sponsor block", reason: "sponsored" }],
};

const ISSUE: ScoredIssue = {
  text: TEXT,
  url: "https://news.example/p/issue",
  referenceCount: 2,
  referenceUrls: ["https://acme.example/model", "https://gamma.example/x"],
  golden: GOLDEN,
};

function outcome(
  output: ExtractionOutput | null,
  grade: ExtractionGrade | null = null,
  error: string | null = null
): Outcome<ScoredIssue, ExtractionOutput, ExtractionGrade> {
  return outcomeOf({ item: ISSUE, output, grade, error });
}

describe("urlsInText", () => {
  it("finds markdown and bare links, cleaned", () => {
    expect([...urlsInText(TEXT)].sort()).toEqual(["https://acme.example/model", "https://beta.example/raise", "https://news.example/p/issue"]);
  });
});

describe("checkExtraction", () => {
  it("passes stories whose links are in the text, with allowed categories and no duplicates", () => {
    const checks = checkExtraction(TEXT, [story("https://acme.example/model"), story("https://beta.example/raise?utm_campaign=x"), story("")]);
    expect(checks).toEqual({ urlsNotInText: 0, pagesNotInText: 0, badCategories: 0, duplicates: 0 });
  });

  it("counts a link that is not in the text", () => {
    expect(checkExtraction(TEXT, [story("https://made.up/link")])).toMatchObject({ urlsNotInText: 1, pagesNotInText: 1 });
  });

  it("finds the page of a link whose query changed, though not the exact link", () => {
    expect(checkExtraction(TEXT, [story("https://beta.example/raise/?share=1")])).toMatchObject({ urlsNotInText: 1, pagesNotInText: 0 });
  });

  it("counts a category the prompt does not allow", () => {
    expect(checkExtraction(TEXT, [story("", { category: "Gossip" as never })]).badCategories).toBe(1);
  });

  it("counts a duplicate by link", () => {
    expect(checkExtraction(TEXT, [story("https://acme.example/model"), story("https://acme.example/model", { headline: "Other" })]).duplicates).toBe(1);
  });

  it("counts a duplicate by headline, ignoring case and spaces", () => {
    expect(checkExtraction(TEXT, [story("", { headline: "Same" }), story("", { headline: "same " })]).duplicates).toBe(1);
  });
});

describe("linkedStoryUrls", () => {
  const ISSUE_URL = "https://news.example/p/issue";

  it("cleans the links and keeps each once", () => {
    expect(linkedStoryUrls([story("https://acme.example/model?utm_source=a"), story("https://acme.example/model")], ISSUE_URL)).toEqual([
      "https://acme.example/model",
    ]);
  });

  it("drops an empty link", () => {
    expect(linkedStoryUrls([story("")], ISSUE_URL)).toEqual([]);
  });

  it("drops a link to the newsletter's own site", () => {
    expect(linkedStoryUrls([story("https://news.example/p/other")], ISSUE_URL)).toEqual([]);
  });
});

describe("foundGolden", () => {
  it("counts golden stories matched as a story or a roundup item, each once", () => {
    const verdicts = [verdict(1), verdict(2, { golden: [1] }), verdict(3, { kind: "roundup_item", golden: [3] })];
    expect([...foundGolden(GOLDEN, verdicts)].sort()).toEqual([1, 3]);
  });

  it("does not count a merged story, a fragment, or a number outside the list", () => {
    const verdicts = [verdict(1, { kind: "merged", golden: [1, 2] }), verdict(2, { kind: "fragment", golden: [3] }), verdict(3, { golden: [9] })];
    expect(foundGolden(GOLDEN, verdicts).size).toBe(0);
  });
});

describe("scoreExtraction", () => {
  // Golden 1 found right; 2 found with the wrong category, importance and url; 3 (a roundup) split into items;
  // 4 missed. Plus a filtered story and an extra one.
  const golden: ExtractionGolden = {
    ...GOLDEN,
    stories: [...GOLDEN.stories, { label: "Gamma partnership", url: "https://gamma.example/x", category: "Industry", importance: 3 }],
  };
  const good: ExtractionOutput = {
    stories: [
      story("https://acme.example/model?utm_source=news", { category: "Launches", importance_score: 4 }),
      story("https://made.up/link"),
      story("https://tools.example/a", { category: "Tools" }),
      story("https://tools.example/b", { category: "Tools" }),
      story("", { headline: "Beta Raise", category: "Industry", importance_score: 5 }),
      story("", { headline: "Something Else" }),
    ],
  };
  const grade: ExtractionGrade = {
    stories: [
      verdict(1, { golden: [1] }),
      verdict(2, { kind: "filtered", golden: [], unsupported_facts: 2, headline_ok: false }),
      verdict(3, { kind: "roundup_item", golden: [3] }),
      verdict(4, { kind: "roundup_item", golden: [3] }),
      verdict(5, { golden: [2] }),
      verdict(6, { kind: "extra", golden: [] }),
    ],
  };
  const issue = { ...ISSUE, golden };
  const metrics = () =>
    Object.fromEntries(
      scoreExtraction([outcomeOf({ item: issue, output: good, grade }), outcomeOf<ScoredIssue, ExtractionOutput, ExtractionGrade>({ item: issue, error: "boom" })]).map(
        (metric) => [metric.name, metric]
      )
    );

  it("counts an error as a miss", () => {
    expect(metrics()["Valid output"]).toEqual({ name: "Valid output", hits: 1, n: 2 });
  });

  it("counts the issue checks per run", () => {
    expect(metrics()["Issues: all story URLs in text"]).toEqual({ name: "Issues: all story URLs in text", hits: 0, n: 2 });
    expect(metrics()["Issues: categories allowed"]).toEqual({ name: "Issues: categories allowed", hits: 1, n: 2 });
    expect(metrics()["Issues: no duplicates"]).toEqual({ name: "Issues: no duplicates", hits: 1, n: 2 });
  });

  it("counts recall over the golden stories, a split roundup found", () => {
    expect(metrics()["Recall (golden)"]).toEqual({ name: "Recall (golden)", hits: 3, n: 4 });
    expect(metrics()["Missed per issue"]).toEqual({ name: "Missed per issue", value: 1 });
  });

  it("counts precision over the extracted stories, leaving out roundup items", () => {
    expect(metrics()["Precision (golden)"]).toEqual({ name: "Precision (golden)", hits: 2, n: 4 });
  });

  it("compares category, importance and cleaned url with the matched golden story", () => {
    expect(metrics()["Category = golden"]).toEqual({ name: "Category = golden", hits: 1, n: 2 });
    expect(metrics()["Importance within 1 of golden"]).toEqual({ name: "Importance within 1 of golden", hits: 1, n: 2 });
    expect(metrics()["URL = golden"]).toEqual({ name: "URL = golden", hits: 1, n: 2 });
  });

  it("counts the judge's own checks over every extracted story", () => {
    expect(metrics()["Faithful stories"]).toEqual({ name: "Faithful stories", hits: 5, n: 6 });
    expect(metrics()["Headline rules"]).toEqual({ name: "Headline rules", hits: 5, n: 6 });
  });

  it("averages the extra stories per graded run", () => {
    expect(metrics()["Extra per issue"]).toEqual({ name: "Extra per issue", value: 1 });
  });

  it("finds golden links with no judge, an error finding none", () => {
    expect(metrics()["Golden URLs found"]).toEqual({ name: "Golden URLs found", hits: 1, n: 6 });
    expect(metrics()["Golden per issue"]).toEqual({ name: "Golden per issue", value: 4 });
  });

  it("averages the stories and the saved stories per valid run", () => {
    expect(metrics()["Stories per issue"]).toEqual({ name: "Stories per issue", value: 6 });
    expect(metrics()["Saved per issue"]).toEqual({ name: "Saved per issue", value: 4 });
  });

  it("compares the saved stories with the dev DB reference", () => {
    expect(metrics()["Dev DB per issue"]).toEqual({ name: "Dev DB per issue", value: 2 });
    expect(metrics()["Saved vs dev DB"]).toEqual({ name: "Saved vs dev DB", value: 2 });
    expect(metrics()["Dev DB URLs found"]).toEqual({ name: "Dev DB URLs found", hits: 1, n: 4 });
  });

  it("leaves out the judge's metrics when no run was graded", () => {
    const names = scoreExtraction([outcome({ stories: [story("")] })]).map((metric) => metric.name);
    expect(names).toContain("Golden URLs found");
    expect(names).not.toContain("Recall (golden)");
  });

  it("leaves out the reference comparison when the issue has no reference", () => {
    const unreferenced = { ...outcome({ stories: [story("")] }), item: { ...ISSUE, referenceCount: null, referenceUrls: [] } };
    expect(scoreExtraction([unreferenced]).map((metric) => metric.name)).not.toContain("Dev DB per issue");
  });
});
