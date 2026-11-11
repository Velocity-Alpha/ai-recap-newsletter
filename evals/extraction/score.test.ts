import { describe, expect, it } from "vitest";

import type { ExtractionGrade, StoryVerdict } from "@/evals/extraction/judge";
import { checkExtraction, linkedStoryUrls, scoreExtraction, urlsInText, type ExtractionOutput, type ScoredIssue } from "@/evals/extraction/score";
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
  unsupported_facts: 0,
  expected_category: "Launches",
  headline_ok: true,
  url_ok: true,
  expected_importance: 3,
  ...extra,
});

const ISSUE: ScoredIssue = { text: TEXT, url: "https://news.example/p/issue", referenceCount: 2, referenceUrls: ["https://acme.example/model", "https://gamma.example/x"] };

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

describe("scoreExtraction", () => {
  const grade: ExtractionGrade = {
    qualifying_in_text: 2,
    missed: 1,
    missed_labels: ["beta raise"],
    stories: [verdict(1), verdict(2, { kind: "filtered", unsupported_facts: 2, expected_category: "Funding", headline_ok: false, url_ok: false, expected_importance: 1 })],
  };
  const good: ExtractionOutput = {
    stories: [story("https://acme.example/model"), story("https://made.up/link", { importance_score: 3 })],
  };
  const metrics = () => Object.fromEntries(scoreExtraction([outcome(good, grade), outcome(null, null, "boom")]).map((metric) => [metric.name, metric]));

  it("counts an error as a miss", () => {
    expect(metrics()["Valid output"]).toEqual({ name: "Valid output", hits: 1, n: 2 });
  });

  it("counts the issue checks per run", () => {
    expect(metrics()["Issues: all story URLs in text"]).toEqual({ name: "Issues: all story URLs in text", hits: 0, n: 2 });
    expect(metrics()["Issues: all story pages in text"]).toEqual({ name: "Issues: all story pages in text", hits: 0, n: 2 });
    expect(metrics()["Issues: categories allowed"]).toEqual({ name: "Issues: categories allowed", hits: 1, n: 2 });
    expect(metrics()["Issues: no duplicates"]).toEqual({ name: "Issues: no duplicates", hits: 1, n: 2 });
  });

  it("counts recall over the qualifying stories the judge found in the text", () => {
    expect(metrics()["Recall (judge)"]).toEqual({ name: "Recall (judge)", hits: 1, n: 2 });
  });

  it("counts precision, faithfulness, headline rules and URL right over the extracted stories", () => {
    expect(metrics()["Precision (judge)"]).toEqual({ name: "Precision (judge)", hits: 1, n: 2 });
    expect(metrics()["Faithful stories"]).toEqual({ name: "Faithful stories", hits: 1, n: 2 });
    expect(metrics()["Headline rules"]).toEqual({ name: "Headline rules", hits: 1, n: 2 });
    expect(metrics()["URL right"]).toEqual({ name: "URL right", hits: 1, n: 2 });
  });

  it("counts category and importance over the stories the judge calls real stories only", () => {
    expect(metrics()["Category right"]).toEqual({ name: "Category right", hits: 1, n: 1 });
    expect(metrics()["Importance within 1"]).toEqual({ name: "Importance within 1", hits: 1, n: 1 });
  });

  it("averages stories and saved stories per valid run", () => {
    expect(metrics()["Stories per issue"]).toEqual({ name: "Stories per issue", value: 2 });
    expect(metrics()["Saved per issue"]).toEqual({ name: "Saved per issue", value: 2 });
  });

  it("compares the saved stories with the dev DB reference", () => {
    expect(metrics()["Dev DB per issue"]).toEqual({ name: "Dev DB per issue", value: 2 });
    expect(metrics()["Saved vs dev DB"]).toEqual({ name: "Saved vs dev DB", value: 1 });
    expect(metrics()["Dev DB URLs found"]).toEqual({ name: "Dev DB URLs found", hits: 1, n: 4 });
  });

  it("leaves out the judge's metrics when no run was graded", () => {
    const names = scoreExtraction([outcome({ stories: [story("")] })]).map((metric) => metric.name);
    expect(names).toContain("Valid output");
    expect(names).not.toContain("Recall (judge)");
  });

  it("leaves out the reference comparison when the issue has no reference", () => {
    const unreferenced = { ...outcome({ stories: [story("")] }), item: { ...ISSUE, referenceCount: null, referenceUrls: [] } };
    expect(scoreExtraction([unreferenced]).map((metric) => metric.name)).not.toContain("Dev DB per issue");
  });
});
