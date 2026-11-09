import { describe, expect, it } from "vitest";

import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";

const EXPECTED_CONTENT = {
  schemaVersion: 2,
  featured_image_url:
    "https://airecap.news/.netlify/images?w=600&q=70&url=https://assets.example.test/newsletter/hero-2026-11-03.jpeg",
  title: "Placeholder Title For Tests",
  date: "2026-11-03",
  issue_id: 268,
  overview: { summary: "Good morning, placeholder overview & summary text. Let's dive in." },
  headlines: [
    {
      story_id: 11023,
      url: "https://news.example.test/story-a?ref=feed&id=1",
      headline: "Headline A",
      story_detail: "Detail A explains the placeholder story.",
      bullets: [
        { before: "First bullet starts", highlight: "with a highlight", after: "and ends here." },
        { before: "Second bullet has", highlight: "Highlight B2", after: ", then punctuation." },
      ],
    },
    {
      story_id: 11007,
      url: "https://news.example.test/story-b",
      headline: "Headline B",
      story_detail: "Detail B.",
      bullets: [{ before: "", highlight: "Only a highlight", after: "follows." }],
    },
  ],
  research_and_analysis: [
    {
      story_id: 10996,
      url: "https://papers.example.test/abs/1234",
      headline: "Paper C",
      story_detail: "Detail C.",
      bullets: [{ before: "Paper bullet", highlight: "key result", after: "for research." }],
    },
  ],
  tools: [
    { story_id: 11009, url: "https://tools.example.test/d", link_text: "Tool D", detail: "does D - well." },
    { story_id: 11010, url: "https://tools.example.test/e", link_text: "Tool E", detail: "" },
  ],
  quick_hits: [
    { story_id: 10998, url: "https://hits.example.test/f", link_text: "Hit F", text: "says F." },
  ],
};

describe("parseSentEmail", () => {
  it("rebuilds the issue content from the draft template HTML", () => {
    const result = parseSentEmail(renderIssueEmail(PLACEHOLDER_ISSUE));

    expect(result).not.toBeNull();
    expect(result?.content).toEqual(EXPECTED_CONTENT);
    expect(result?.storyIds).toEqual([11023, 11007, 10996, 11009, 11010, 10998]);
    expect(result?.problems).toEqual([]);
  });

  it("reads the same content from the received copy, ignoring tracking links and GHL additions", () => {
    const result = parseSentEmail(renderIssueEmail(PLACEHOLDER_ISSUE, { received: true }));

    expect(result?.content).toEqual(EXPECTED_CONTENT);
    expect(result?.problems).toEqual([]);
  });

  it("has no draft id for an email from n8n's template", () => {
    expect(parseSentEmail(renderIssueEmail(PLACEHOLDER_ISSUE))?.draftId).toBeNull();
  });

  it("reads the draft id when the issue wrapper carries one", () => {
    const html = renderIssueEmail(PLACEHOLDER_ISSUE).replace('data-issue-id="268"', 'data-issue-id="268" data-draft-id="17"');

    const result = parseSentEmail(html);

    expect(result?.draftId).toBe(17);
    expect(result?.content).toEqual(EXPECTED_CONTENT);
    expect(result?.problems).toEqual([]);
  });

  it("ignores a draft id that is not a positive whole number", () => {
    for (const value of ["", "abc", "0", "-3", "4.5"]) {
      const html = renderIssueEmail(PLACEHOLDER_ISSUE).replace(
        'data-issue-id="268"',
        `data-issue-id="268" data-draft-id="${value}"`
      );
      expect(parseSentEmail(html)?.draftId).toBeNull();
    }
  });

  it("returns null for an email that is not an issue", () => {
    expect(parseSentEmail("<html><body><p>Unrelated newsletter</p></body></html>")).toBeNull();
    expect(parseSentEmail("")).toBeNull();
  });

  it("keeps empty sections empty and fills missing text with empty strings", () => {
    const result = parseSentEmail(
      renderIssueEmail({
        issueId: 7,
        title: "Short Issue",
        issueDate: "2026-11-09",
        headlines: [{ story_id: 1, url: "https://a.example.test/1", headline: "Only headline" }],
      })
    );

    expect(result?.content).toMatchObject({
      issue_id: 7,
      title: "Short Issue",
      date: "2026-11-09",
      featured_image_url: "",
      overview: { summary: "" },
      headlines: [
        { story_id: 1, url: "https://a.example.test/1", headline: "Only headline", story_detail: "", bullets: [] },
      ],
      research_and_analysis: [],
      tools: [],
      quick_hits: [],
    });
    expect(result?.problems).toEqual(["No overview summary found."]);
  });

  it("strips emoji pieces left in the header title", () => {
    const html = renderIssueEmail({ ...PLACEHOLDER_ISSUE, title: "Title With Flag 🇨🇳" }).replace(
      "Title With Flag",
      "️ Title With Flag"
    );

    expect(parseSentEmail(html)?.content.title).toBe("Title With Flag");
  });

  it("flags stories it cannot place in a known section", () => {
    const html = renderIssueEmail(PLACEHOLDER_ISSUE).replace("🔬 Research &amp; Analysis", "Mystery Section");

    const result = parseSentEmail(html);

    expect(result?.content.research_and_analysis).toEqual([]);
    expect(result?.storyIds).toContain(10996);
    expect(result?.problems).toEqual([
      'Unknown section "Mystery Section" holds stories 10996.',
    ]);
  });

  it("flags a missing or unreadable issue date", () => {
    const html = renderIssueEmail(PLACEHOLDER_ISSUE).replace(/here's your briefing for [^<]+/, "Hello");

    const result = parseSentEmail(html);

    expect(result?.content.date).toBe("");
    expect(result?.problems).toEqual(["No issue date found in the email header."]);
  });
});
