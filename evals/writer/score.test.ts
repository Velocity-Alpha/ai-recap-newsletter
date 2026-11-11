import { describe, expect, it } from "vitest";

import type { Metric } from "@/evals/lib/results";
import { outcomeOf } from "@/evals/lib/testing";
import type { IssueGrade, StoryGrade } from "@/evals/writer/rubric";
import { bulletOverlap, pairMetrics, scoreWriter, stringFields, writerColumns, type WriterOutcome, type WriterRun } from "@/evals/writer/score";
import { bullet, CASE, GOOD } from "@/evals/writer/testing";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";

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
  ...overrides,
});

const outcome = (output: WriterRun | null, repeat = 0, grade: IssueGrade | null = output ? GRADE : null): WriterOutcome =>
  outcomeOf({
    item: CASE,
    id: CASE.date,
    repeat,
    latencyMs: output ? 50_000 : 250_000,
    callMs: output ? [30_000] : [],
    output,
    grade,
    error: output ? null : "The writer stopped before finishing (timeout).",
  });

const byName = (metrics: Metric[]) => Object.fromEntries(metrics.map((metric) => [metric.name, metric]));

describe("scoreWriter on a good draft and a failed run", () => {
  const metrics = () => byName(scoreWriter([outcome(run()), outcome(null, 1)]));

  it("counts a failed run as a miss", () => {
    expect(metrics()["Valid output"]).toEqual({ name: "Valid output", hits: 1, n: 2 });
  });

  it("passes every per-issue code check of the good draft", () => {
    for (const name of [
      "Checks pass, first draft",
      "Stories in section and order",
      "Title 4-8 words",
      "Excerpt 1-2 sentences",
      "Overview 45-80 words",
      "Plain text (no markup, URL, emoji)",
      "No em dash or ellipsis",
    ]) {
      expect(metrics()[name], name).toMatchObject({ hits: 1, n: 2 });
    }
  });

  it("counts per-story checks over the feature stories of every run", () => {
    expect(metrics()["Feature items with 3 bullets"]).toMatchObject({ hits: 3, n: 6 });
    expect(metrics()["Story detail 2-4 sentences"]).toMatchObject({ hits: 3, n: 6 });
  });

  it("counts bullets that do not repeat the story detail over every bullet", () => {
    expect(metrics()["Bullets not repeating detail"]).toMatchObject({ hits: 9, n: 18 });
  });

  it("checks in code the eval's notes on the 2nd top story, the 1st research story and the 1st quick hit", () => {
    expect(metrics()["Notes followed (code)"]).toMatchObject({ hits: 3, n: 6 });
  });

  it("counts a run with no recorded call at its own time, over the 240 s timeout", () => {
    expect(metrics()["Writer calls under 240 s"]).toMatchObject({ hits: 1, n: 2 });
  });
});

describe("scoreWriter on a draft that breaks rules", () => {
  const scored = (draft: WrittenIssueContent, changes: Partial<WriterRun> = {}) => byName(scoreWriter([outcome(run({ first: draft, ...changes }))]));

  it("fails a draft whose first checks found problems, and passes it after a clean rewrite", () => {
    const metrics = scored(GOOD, { firstProblems: ["x"], finalProblems: [] });
    expect(metrics["Checks pass, first draft"]).toMatchObject({ hits: 0 });
    expect(metrics["Checks pass after rewrite"]).toMatchObject({ hits: 1 });
  });

  it("flags a story moved to another section", () => {
    const moved = { ...GOOD, headlines: [GOOD.headlines[0]], research_and_analysis: [GOOD.headlines[1], GOOD.research_and_analysis[0]] };
    expect(scored(moved)["Stories in section and order"]).toMatchObject({ hits: 0 });
  });

  it("flags a title over 8 words", () => {
    expect(scored({ ...GOOD, title: "A very long subject line that keeps on going past eight words" })["Title 4-8 words"]).toMatchObject({ hits: 0 });
  });

  it("flags a URL in the text", () => {
    expect(scored({ ...GOOD, excerpt: "See https://example.com now." })["Plain text (no markup, URL, emoji)"]).toMatchObject({ hits: 0 });
  });

  it("flags an em dash", () => {
    expect(scored({ ...GOOD, excerpt: "A lab ships — now." })["No em dash or ellipsis"]).toMatchObject({ hits: 0 });
  });

  it("flags a bullet that repeats the story detail", () => {
    const repeated = {
      ...GOOD,
      headlines: [
        { ...GOOD.headlines[0], bullets: [{ before: "The lab shipped", highlight: "a model", after: "faster than before." }, ...GOOD.headlines[0].bullets.slice(1)] },
        GOOD.headlines[1],
      ],
    };
    expect(scored(repeated)["Bullets not repeating detail"]).toMatchObject({ hits: 8, n: 9 });
  });
});

describe("scoreWriter on the judge's grades", () => {
  const metrics = () => byName(scoreWriter([outcome(run()), outcome(run(), 1, null)]));

  it("averages unsupported claims per issue over the graded runs", () => {
    expect(metrics()["Unsupported claims per issue (judge)"]).toEqual({ name: "Unsupported claims per issue (judge)", value: 1 });
  });

  it("counts issues with no unsupported claim over the graded runs", () => {
    expect(metrics()["Issues with no unsupported claim (judge)"]).toMatchObject({ hits: 0, n: 1 });
  });

  it("counts judged bullets distinct from the detail over every bullet of a graded run", () => {
    expect(metrics()["Bullets distinct from detail (judge)"]).toMatchObject({ hits: 6, n: 9 });
  });

  it("counts bullets from article text only for stories with article text", () => {
    // Only stories 1 and 3 have article text.
    expect(metrics()["Bullets from article text (judge)"]).toMatchObject({ hits: 2, n: 6 });
  });

  it("counts notes followed over the stories with a note", () => {
    expect(metrics()["Notes followed (judge)"]).toMatchObject({ hits: 2, n: 3 });
  });

  it("averages the editorial quality", () => {
    expect(metrics()["Editorial quality 1-5 (judge)"]).toEqual({ name: "Editorial quality 1-5 (judge)", value: 4 });
  });
});

describe("pairMetrics", () => {
  it("gives nothing when no pair was judged", () => {
    expect(pairMetrics([], "high")).toEqual([]);
  });

  it("counts wins and ties against the baseline", () => {
    const metrics = byName(pairMetrics(["win", "tie", "loss"], "high"));
    expect(metrics["Wins vs high (pairwise)"]).toMatchObject({ hits: 1, n: 3 });
    expect(metrics["Ties vs high (pairwise)"]).toMatchObject({ hits: 1, n: 3 });
  });

  it("scores the preference as a win plus half a tie", () => {
    expect(byName(pairMetrics(["win", "tie", "loss"], "high"))["Preference vs high (win + tie/2)"]).toEqual({
      name: "Preference vs high (win + tie/2)",
      value: 0.5,
    });
  });
});

describe("writerColumns", () => {
  it("names the pairwise columns for the baseline", () => {
    expect(writerColumns("high")).toEqual(expect.arrayContaining(["Wins vs high (pairwise)"]));
  });

  it("keeps the old rows' comparison with low", () => {
    expect(writerColumns("high")).toEqual(expect.arrayContaining(["Preference vs low (win + tie/2)"]));
  });

  it("lists the comparison with low once when low is the baseline", () => {
    expect(writerColumns("low").filter((name) => name === "Preference vs low (win + tie/2)")).toHaveLength(1);
  });
});

describe("bulletOverlap", () => {
  it("is 1 for a bullet whose words are all in the story detail", () => {
    expect(bulletOverlap({ before: "The lab", highlight: "shipped", after: "a faster model" }, "The lab shipped a model. It is faster.")).toBe(1);
  });

  it("is 0 for a bullet with none of the detail's words", () => {
    expect(bulletOverlap(bullet("hired 12 researchers"), "The lab shipped a model.")).toBe(0);
  });
});

describe("stringFields", () => {
  it("lists every string field of a draft", () => {
    expect(stringFields(GOOD)).toHaveLength(3 + 3 * (2 + 9) + 2 + 2);
  });
});
