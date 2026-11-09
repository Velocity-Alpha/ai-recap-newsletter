import { describe, expect, it } from "vitest";

import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT } from "@/src/pipeline/draft/draft.fixture";
import { assertValidContent, countWords, findContentProblems } from "@/src/pipeline/draft/validate";

function edit(change: (content: WrittenIssueContent) => void): WrittenIssueContent {
  const content = structuredClone(SAMPLE_CONTENT);
  change(content);
  return content;
}

function words(count: number): string {
  return Array.from({ length: count }, (_, index) => `word${index}`).join(" ");
}

describe("countWords", () => {
  it("counts runs of letters or digits and ignores stray punctuation", () => {
    expect(countWords("ChatGPT’s Workspace Gets Simpler")).toBe(4);
    expect(countWords("  AI-powered tools - and 2 more  ")).toBe(5);
    expect(countWords("")).toBe(0);
  });
});

describe("findContentProblems", () => {
  it("passes content that covers every approved story correctly", () => {
    expect(findContentProblems(SAMPLE_CONTENT, SAMPLE_APPROVED)).toEqual([]);
  });

  it("reports an approved story that is missing", () => {
    const content = edit((c) => c.quick_hits.pop());

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual(["Story 508 (Quick Hits) is missing."]);
  });

  it("reports a story that appears more than once", () => {
    const content = edit((c) => c.tools.push({ ...c.tools[0] }));

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual(["Story 505 appears 2 times; it must appear once."]);
  });

  it("reports a story written into the wrong section", () => {
    const content = edit((c) => {
      const [moved] = c.quick_hits.splice(0, 1);
      c.tools.push({ story_id: moved.story_id, url: moved.url, link_text: moved.link_text, detail: moved.text });
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      "Story 507 is in Tools but was approved for Quick Hits.",
    ]);
  });

  it("reports a story id that was not approved, and its link", () => {
    const content = edit((c) => {
      c.tools[1] = { ...c.tools[1], story_id: 999, url: "https://invented.example.test/x" };
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      "Tools item 2 has story_id 999, which is not an approved story.",
      'Tools item 2 links to "https://invented.example.test/x", which is not an approved link.',
      "Story 506 (Tools) is missing.",
    ]);
  });

  it("reports a link that differs from the story's approved link", () => {
    const content = edit((c) => {
      c.headlines[0].url = "https://news.example.test/planner";
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      'Story 501 links to "https://news.example.test/planner", not its approved link "https://news.example.test/planner?ref=feed&id=1".',
    ]);
  });

  it("checks the title is 4 to 8 words", () => {
    expect(findContentProblems(edit((c) => (c.title = "Too Short")), SAMPLE_APPROVED)).toEqual([
      'The title has 2 words; it needs 4 to 8: "Too Short".',
    ]);
    expect(findContentProblems(edit((c) => (c.title = words(9))), SAMPLE_APPROVED)).toEqual([
      `The title has 9 words; it needs 4 to 8: "${words(9)}".`,
    ]);
    expect(findContentProblems(edit((c) => (c.title = words(8))), SAMPLE_APPROVED)).toEqual([]);
  });

  it("checks the overview is 45 to 80 words", () => {
    expect(findContentProblems(edit((c) => (c.overview.summary = words(44))), SAMPLE_APPROVED)).toEqual([
      "The overview has 44 words; it needs 45 to 80.",
    ]);
    expect(findContentProblems(edit((c) => (c.overview.summary = words(81))), SAMPLE_APPROVED)).toEqual([
      "The overview has 81 words; it needs 45 to 80.",
    ]);
    expect(findContentProblems(edit((c) => (c.overview.summary = words(45))), SAMPLE_APPROVED)).toEqual([]);
    expect(findContentProblems(edit((c) => (c.overview.summary = words(80))), SAMPLE_APPROVED)).toEqual([]);
  });

  it("checks every feature story has exactly 3 bullets, each with a highlight", () => {
    const content = edit((c) => {
      c.headlines[1].bullets.pop();
      c.research_and_analysis[0].bullets[2].highlight = " ";
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      "Story 502 has 2 bullets; feature stories need exactly 3.",
      "Story 503 bullet 3 has no highlighted phrase.",
    ]);
  });

  it("checks the text the website needs is there", () => {
    const content = edit((c) => {
      c.excerpt = "";
      c.headlines[0].headline = "";
      c.tools[0].link_text = " ";
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      "The excerpt is empty.",
      "Story 501 has no headline.",
      "Story 505 has no link text.",
    ]);
  });

  it("flags links and markup inside text fields", () => {
    const content = edit((c) => {
      c.overview.summary = `${c.overview.summary} See https://elsewhere.example.test.`;
      c.headlines[0].story_detail = "A [made-up](https://x.example.test) link.";
      c.quick_hits[0].text = "raised a <b>pretend</b> round.";
    });

    expect(findContentProblems(content, SAMPLE_APPROVED)).toEqual([
      "The overview contains a link or markup; text must be plain.",
      "Story 501 story_detail contains a link or markup; text must be plain.",
      "Story 507 text contains a link or markup; text must be plain.",
    ]);
  });
});

describe("assertValidContent", () => {
  it("does nothing for valid content", () => {
    expect(() => assertValidContent(SAMPLE_CONTENT, SAMPLE_APPROVED)).not.toThrow();
  });

  it("throws one error that lists every problem", () => {
    const content = edit((c) => {
      c.title = "Short";
      c.quick_hits.pop();
    });

    expect(() => assertValidContent(content, SAMPLE_APPROVED)).toThrow(
      'The written issue failed 2 checks: The title has 1 word; it needs 4 to 8: "Short". | Story 508 (Quick Hits) is missing.'
    );
  });
});
