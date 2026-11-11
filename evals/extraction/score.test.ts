import { describe, expect, it } from "vitest";

import type { ExtractionGrade, StoryVerdict } from "@/evals/extraction/judge";
import { checkExtraction, linkedStoryUrls, scoreExtraction, urlsInText, type ExtractionOutput, type ScoredIssue } from "@/evals/extraction/score";
import type { Outcome } from "@/evals/lib/sweep";
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

function outcome(output: ExtractionOutput | null, error: string | null = null): Outcome<ScoredIssue, ExtractionOutput> {
  return { item: ISSUE, id: "i", repeat: 0, latencyMs: 1, output, error };
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

  it("counts a link that is not in the text, a bad category and a duplicate by link or headline", () => {
    const checks = checkExtraction(TEXT, [
      story("https://acme.example/model"),
      story("https://acme.example/model", { headline: "Other" }),
      story("https://made.up/link"),
      // The right page with its query dropped: not the exact link, but the page is in the text.
      story("https://beta.example/raise/?share=1", { headline: "Beta" }),
      story("", { headline: "Same", category: "Gossip" as never }),
      story("", { headline: "same " }),
    ]);
    expect(checks).toEqual({ urlsNotInText: 2, pagesNotInText: 1, badCategories: 1, duplicates: 2 });
  });
});

describe("linkedStoryUrls", () => {
  it("keeps the cleaned links production would save: not empty, not the newsletter's own site, deduplicated", () => {
    const urls = linkedStoryUrls([story("https://acme.example/model?utm_source=a"), story("https://acme.example/model"), story(""), story("https://news.example/p/other")], "https://news.example/p/issue");
    expect(urls).toEqual(["https://acme.example/model"]);
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
    grade,
  };

  it("scores issue checks, judge counts over stories, and the reference comparison; an error is a miss", () => {
    const metrics = scoreExtraction([outcome(good), outcome(null, "boom")]);
    const byName = Object.fromEntries(metrics.map((metric) => [metric.name, metric]));
    expect(byName["Valid output"]).toEqual({ name: "Valid output", hits: 1, n: 2 });
    expect(byName["Issues: all story URLs in text"]).toEqual({ name: "Issues: all story URLs in text", hits: 0, n: 2 });
    expect(byName["Issues: all story pages in text"]).toEqual({ name: "Issues: all story pages in text", hits: 0, n: 2 });
    expect(byName["Issues: categories allowed"]).toEqual({ name: "Issues: categories allowed", hits: 1, n: 2 });
    expect(byName["Issues: no duplicates"]).toEqual({ name: "Issues: no duplicates", hits: 1, n: 2 });
    expect(byName["Recall (judge)"]).toEqual({ name: "Recall (judge)", hits: 1, n: 2 });
    expect(byName["Precision (judge)"]).toEqual({ name: "Precision (judge)", hits: 1, n: 2 });
    expect(byName["Faithful stories"]).toEqual({ name: "Faithful stories", hits: 1, n: 2 });
    // Category and importance: over the stories the judge calls real stories.
    expect(byName["Category right"]).toEqual({ name: "Category right", hits: 1, n: 1 });
    expect(byName["Headline rules"]).toEqual({ name: "Headline rules", hits: 1, n: 2 });
    expect(byName["URL right"]).toEqual({ name: "URL right", hits: 1, n: 2 });
    expect(byName["Importance within 1"]).toEqual({ name: "Importance within 1", hits: 1, n: 1 });
    expect(byName["Graded runs"]).toEqual({ name: "Graded runs", hits: 1, n: 2 });
    expect(byName["Stories per issue"]).toEqual({ name: "Stories per issue", value: 2 });
    expect(byName["Saved per issue"]).toEqual({ name: "Saved per issue", value: 2 });
    expect(byName["Dev DB per issue"]).toEqual({ name: "Dev DB per issue", value: 2 });
    expect(byName["Saved vs dev DB"]).toEqual({ name: "Saved vs dev DB", value: 1 });
    expect(byName["Dev DB URLs found"]).toEqual({ name: "Dev DB URLs found", hits: 1, n: 4 });
  });

  it("leaves out judge metrics when no run was graded, and the reference when there is none", () => {
    const metrics = scoreExtraction([{ ...outcome({ stories: [story("")], grade: null }), item: { ...ISSUE, referenceCount: null, referenceUrls: [] } }]);
    const names = metrics.map((metric) => metric.name);
    expect(names).toContain("Valid output");
    expect(names).not.toContain("Recall (judge)");
    expect(names).not.toContain("Dev DB per issue");
  });
});
