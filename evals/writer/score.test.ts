import { describe, expect, it } from "vitest";

import type { Metric } from "@/evals/lib/results";
import type { Outcome } from "@/evals/lib/sweep";
import type { WriterCase } from "@/evals/writer/dataset";
import { countSentences, withEvalNotes } from "@/evals/writer/notes";
import type { IssueGrade, StoryGrade } from "@/evals/writer/rubric";
import { gradeInput, pairInput } from "@/evals/writer/rubric";
import { bulletOverlap, scoreWriter, stringFields, type WriterRun } from "@/evals/writer/score";
import type { ApprovedStory, WrittenIssueContent } from "@/src/pipeline/draft/content";

const story = (id: number, note = ""): ApprovedStory => ({
  id,
  headline: `Headline ${id}`,
  summary: `Summary ${id}`,
  storyDetails: null,
  url: `https://example.com/${id}`,
  note,
});

const CASE: WriterCase = {
  date: "2026-11-05",
  issueId: 1,
  sections: "issue_stories",
  input: {
    sections: { headlines: [story(1), story(2)], research: [story(3)], tools: [story(4)], quickHits: [story(5)] },
    leadStoryId: 1,
    articles: [{ storyId: 1, text: "Article one." }, { storyId: 2, unread: true }, { storyId: 3, text: "Article three." }],
  },
  articleSources: { "1": "saved", "2": "unread:blocked", "3": "read:fetch" },
};

const bullet = (highlight: string) => ({ before: "The team", highlight, after: "this quarter." });
const feature = (id: number, headline: string, detail: string) => ({
  story_id: id,
  url: `https://example.com/${id}`,
  headline,
  story_detail: detail,
  bullets: [bullet("cut latency by 40%"), bullet("hired 12 researchers"), bullet("opened a Paris office")],
});

const GOOD: WrittenIssueContent = {
  title: "Lab ships faster reasoning model",
  excerpt: "A lab ships a faster model. Rivals respond.",
  overview: {
    summary:
      "Good morning, a lab shipped a faster reasoning model and rivals are scrambling to answer it with their own launches. " +
      "Researchers also found a cheaper way to train small models, and a new tool makes agents easier to test before release, which could save teams real time this week. " +
      "Let's dive in.",
  },
  headlines: [
    feature(1, "Lab ships a faster model", "The lab shipped a model. It is faster than before."),
    feature(2, "Rival answers back", "A rival answered. It priced lower."),
  ],
  research_and_analysis: [feature(3, "Can small models learn cheaply?", "Researchers trained small models. Costs fell.")],
  tools: [{ story_id: 4, url: "https://example.com/4", link_text: "AgentTest", detail: "tests agents before release." }],
  quick_hits: [{ story_id: 5, url: "https://example.com/5", link_text: "Chip maker", text: "raises a new round." }],
};

const GRADE: IssueGrade = {
  stories: [1, 2, 3].map((id): StoryGrade => ({
    story_id: id,
    unsupported_claims: id === 2 ? 1 : 0,
    bullets: [
      { distinct_from_detail: true, from_article_text: id !== 2 },
      { distinct_from_detail: true, from_article_text: false },
      { distinct_from_detail: false, from_article_text: false },
    ],
    note: id === 2 ? "followed" : id === 3 ? "not_followed" : "no_note",
  })).concat([4, 5].map((id): StoryGrade => ({ story_id: id, unsupported_claims: 0, bullets: [], note: id === 5 ? "followed" : "no_note" }))),
  intro_unsupported_claims: 0,
  editorial_quality: 4,
  quality_reason: "Crisp.",
};

const run = (overrides: Partial<WriterRun> = {}): WriterRun => ({
  first: GOOD,
  firstProblems: [],
  finalProblems: [],
  writerMs: [30_000],
  grade: GRADE,
  pair: null,
  ...overrides,
});

const outcome = (output: WriterRun | null, repeat = 0): Outcome<WriterCase, WriterRun> => ({
  item: CASE,
  id: CASE.date,
  repeat,
  latencyMs: output ? 50_000 : 250_000,
  output,
  error: output ? null : "The writer stopped before finishing (timeout).",
});

const byName = (metrics: Metric[]) => Object.fromEntries(metrics.map((metric) => [metric.name, metric]));

describe("scoreWriter", () => {
  it("scores the code checks of a good draft and counts an error as a miss", () => {
    const metrics = byName(scoreWriter([outcome(run()), outcome(null, 1)]));
    expect(metrics["Valid output"]).toEqual({ name: "Valid output", hits: 1, n: 2 });
    expect(metrics["Checks pass, first draft"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Stories in section and order"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Feature items with 3 bullets"]).toMatchObject({ hits: 3, n: 6 });
    expect(metrics["Story detail 2-4 sentences"]).toMatchObject({ hits: 3, n: 6 });
    expect(metrics["Title 4-8 words"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Excerpt 1-2 sentences"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Overview 45-80 words"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Plain text (no markup, URL, emoji)"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["No em dash or ellipsis"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Bullets not repeating detail"]).toMatchObject({ hits: 9, n: 18 });
    // The eval's notes land on the 2nd top story, the 1st research story and the 1st quick hit.
    expect(metrics["Notes followed (code)"]).toMatchObject({ hits: 3, n: 6 });
    // The failed run's call is counted at its latency, over the 240 s timeout.
    expect(metrics["Writer calls under 240 s"]).toMatchObject({ hits: 1, n: 2 });
    expect(metrics["Writer max s"]).toEqual({ name: "Writer max s", value: 250 });
    expect(metrics["Writer p50 s"]).toEqual({ name: "Writer p50 s", value: 30 });
  });

  it("finds broken rules: a moved story, markup, an em dash, a long title, a repeated bullet, and checks after rewrite", () => {
    const bad: WrittenIssueContent = {
      ...GOOD,
      title: "A very long subject line that keeps on going past eight words",
      excerpt: "See https://example.com — now.",
      headlines: [{ ...GOOD.headlines[0], bullets: [{ before: "The lab shipped", highlight: "a model", after: "faster than before." }, ...GOOD.headlines[0].bullets.slice(1)] }],
      research_and_analysis: [GOOD.headlines[1], GOOD.research_and_analysis[0]],
    };
    const metrics = byName(scoreWriter([outcome(run({ first: bad, firstProblems: ["x"], finalProblems: [] }))]));
    expect(metrics["Checks pass, first draft"]).toMatchObject({ hits: 0 });
    expect(metrics["Checks pass after rewrite"]).toMatchObject({ hits: 1 });
    expect(metrics["Stories in section and order"]).toMatchObject({ hits: 0 });
    expect(metrics["Title 4-8 words"]).toMatchObject({ hits: 0 });
    expect(metrics["Plain text (no markup, URL, emoji)"]).toMatchObject({ hits: 0 });
    expect(metrics["No em dash or ellipsis"]).toMatchObject({ hits: 0 });
    expect(metrics["Bullets not repeating detail"]).toMatchObject({ hits: 8, n: 9 });
  });

  it("turns the judge's grades into counts and means, and a missing grade into a judge failure", () => {
    const metrics = byName(scoreWriter([outcome(run()), outcome(run({ grade: null }), 1)]));
    expect(metrics["Unsupported claims per issue (judge)"]).toEqual({ name: "Unsupported claims per issue (judge)", value: 1 });
    expect(metrics["Issues with no unsupported claim (judge)"]).toMatchObject({ hits: 0, n: 2 });
    expect(metrics["Bullets distinct from detail (judge)"]).toMatchObject({ hits: 6, n: 9 });
    // Only stories 1 and 3 have article text.
    expect(metrics["Bullets from article text (judge)"]).toMatchObject({ hits: 2, n: 6 });
    expect(metrics["Notes followed (judge)"]).toMatchObject({ hits: 2, n: 3 });
    expect(metrics["Editorial quality 1-5 (judge)"]).toEqual({ name: "Editorial quality 1-5 (judge)", value: 4 });
    expect(metrics["Judge failures"]).toEqual({ name: "Judge failures", value: 1 });
  });

  it("adds pairwise metrics only when pairs ran", () => {
    expect(byName(scoreWriter([outcome(run())]))["Wins vs low (pairwise)"]).toBeUndefined();
    const metrics = byName(
      scoreWriter([
        outcome(run({ pair: { result: "win", thisFirst: true } })),
        outcome(run({ pair: { result: "tie", thisFirst: false } }), 1),
        outcome(run({ pair: { result: "loss", thisFirst: true } }), 1),
      ])
    );
    expect(metrics["Wins vs low (pairwise)"]).toMatchObject({ hits: 1, n: 3 });
    expect(metrics["Ties vs low (pairwise)"]).toMatchObject({ hits: 1, n: 3 });
    expect(metrics["Preference vs low (win + tie/2)"]).toEqual({ name: "Preference vs low (win + tie/2)", value: 0.5 });
  });
});

describe("helpers", () => {
  it("counts sentences without splitting decimals", () => {
    expect(countSentences("It costs $3.50 a month. It ships today!")).toBe(2);
    expect(countSentences("One sentence only")).toBe(1);
  });

  it("measures a bullet's overlap with its story detail", () => {
    expect(bulletOverlap({ before: "The lab", highlight: "shipped", after: "a faster model" }, "The lab shipped a model. It is faster.")).toBe(1);
    expect(bulletOverlap(bullet("hired 12 researchers"), "The lab shipped a model.")).toBe(0);
  });

  it("lists every string field", () => {
    expect(stringFields(GOOD)).toHaveLength(3 + 3 * (2 + 9) + 2 + 2);
  });

  it("adds the eval's notes without changing the input, and keeps an owner's note", () => {
    const owned = { ...CASE.input, sections: { ...CASE.input.sections, quickHits: [story(5, "Owner note.")] } };
    const { input, noted } = withEvalNotes(owned);
    expect(noted.map((entry) => entry.storyId)).toEqual([2, 3]);
    expect(input.sections.headlines[1].note).toBe("Keep the story detail to two sentences.");
    expect(input.sections.quickHits[0].note).toBe("Owner note.");
    expect(owned.sections.headlines[1].note).toBe("");
  });

  it("puts the source before the draft for the grade, and leaves article text out of the pair", () => {
    const grade = gradeInput(CASE.input, GOOD);
    expect(grade.indexOf("Article one.")).toBeLessThan(grade.indexOf("DRAFT:"));
    const pair = pairInput(CASE.input, GOOD, GOOD);
    expect(pair).not.toContain("Article one.");
    expect(pair).toContain("DRAFT B:");
  });
});
