// The issue writer (src/pipeline/draft/writer.ts) on 30 past issues from the Neon dev branch. evals/README.md.
import { expect, it } from "vitest";

import { goldenFor, loadGolden, missingGolden } from "@/evals/lib/golden";
import { effortLabel, evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { articleCoverage, loadCases, type WriterCase } from "@/evals/writer/dataset";
import { GOLDEN_PATH, goldenInputOf, goldenProblems, type GoldenIssue } from "@/evals/writer/golden";
import { draftFirst, gradeWriter } from "@/evals/writer/grade";
import { EVAL_NOTES, writerInputOf } from "@/evals/writer/notes";
import { scoreWriter, writerColumns, type WriterGrade, type WriterRun } from "@/evals/writer/score";
import { findContentProblems } from "@/src/pipeline/draft/validate";
import { createOpenAIIssueWriter, WRITER_EFFORT, WRITER_MODEL } from "@/src/pipeline/draft/writer";

/** One draft as production makes it: write, check, and one rewrite with the problems when a check fails. */
async function write(item: WriterCase, context: RunContext): Promise<WriterRun> {
  const { model, effort } = context.config;
  const writer = createOpenAIIssueWriter({ client: context.client, model, effort });
  const input = writerInputOf(item);

  const first = await writer(input);
  const firstProblems = findContentProblems(first, input.sections);
  let finalProblems = firstProblems;
  if (firstProblems.length > 0) {
    try {
      const rewritten = await writer({ ...input, revision: { previous: first, problems: firstProblems } });
      finalProblems = findContentProblems(rewritten, input.sections);
    } catch (error) {
      finalProblems = [`The rewrite failed: ${error instanceof Error ? error.message : String(error)}`];
    }
  }
  return { first, firstProblems, finalProblems };
}

it("writer: code checks, faithfulness grades and wins against the golden issue, per effort", async () => {
  const settings = evalSettings({
    model: WRITER_MODEL,
    efforts: ["none", "low", "medium", "high"],
    repeats: 2,
    baseline: WRITER_EFFORT,
  });
  const cases = loadCases();
  const coverage = articleCoverage(cases);

  const golden = loadGolden<GoldenIssue>(GOLDEN_PATH);
  const missing = missingGolden(golden, cases.map((item) => ({ id: item.date, input: goldenInputOf(item) })));
  if (missing.length > 0) {
    throw new Error(`No current golden issue for ${missing.join(", ")}. Write them first: evals/writer/golden-todo.md.`);
  }
  for (const item of cases) {
    const problems = goldenProblems(item, goldenFor(golden, item.date, goldenInputOf(item)));
    if (problems.length > 0) console.warn(`[writer] the golden issue of ${item.date} fails checks: ${problems.join(" | ")}`);
  }

  const grade = (item: WriterCase, output: WriterRun, context: GradeContext): Promise<WriterGrade> =>
    gradeWriter(item, output, {
      judge: context.judge,
      golden: goldenFor(golden, item.date, goldenInputOf(item)),
      draftFirst: draftFirst(item.date, context.repeat, `${context.config.model}|${effortLabel(context.config.effort)}`),
    });

  const { rows, path } = await runSweep({
    task: "writer",
    title: "Issue writer eval",
    notes: [
      `The issue writer on ${cases.length} issues (${cases[cases.length - 1]?.date} to ${cases[0]?.date}; evals/writer/manifest.json), ` +
        "built by evals/writer/build-dataset.ts from the Neon dev branch (read-only) as drafting builds the writer's input. " +
        "Sections and board order: issue_stories (the sent email) for published issues, the board's commit for 2026-11-09 " +
        "(a draft, the only issue with a board commit). Rows with git sha 035179c+changes (n = 12) ran on the first 6 of these issues.",
      `Article text for the ${coverage.features} feature stories: ${coverage.saved} saved copies (story_articles), ` +
        `${coverage.read} read by the repo's article reader on the build day, ${coverage.unread} not read (summaries only).`,
      `No issue had owner notes, so the eval adds ${EVAL_NOTES.length} of its own to each issue (evals/writer/notes.ts), each checked in code.`,
      "Every metric reads the first draft, except \"Checks pass after rewrite\", which runs production's one rewrite. " +
        "Cost per call and p50/p95 include the rewrites; p50/p95 are the writer calls alone (the writer times out at " +
        "240 s in production). Rows with git sha 035179c+changes (before d1da5b8) timed the judge in p50/p95 too, and " +
        "have the writer calls alone in \"Writer p50 s\" and \"Writer max s\".",
      "The judge grades each first draft against the writer's exact input (evals/writer/rubric.ts, which imports the " +
        "writer's rules from writer.ts): unsupported claims counted per story, each bullet, each note, and editorial " +
        "quality on anchored 1-5; (judge) counts are over the graded runs.",
      "Golden: for each issue, a reference issue written by Claude Opus from the writer's exact input and instructions " +
        "(evals/data/writer/golden.json, not committed; evals/writer/golden-todo.md). The pairwise judge compares each " +
        "first draft with it, blind and in random order, without the article text; \"vs golden\" counts are over the " +
        "graded runs, and a run that errored is a loss. Since the reference is fixed, win rates compare across efforts " +
        "and models. Rows with git sha 035179c+changes compared each effort with low instead. The table shows chosen " +
        "columns; all metrics are in the stored rows.",
    ],
    settings,
    items: cases,
    id: (item) => item.date,
    run: write,
    grade,
    score: scoreWriter,
    columns: writerColumns(),
    raw: (outcome) => ({
      firstProblems: outcome.output?.firstProblems.length ?? null,
      finalProblems: outcome.output?.finalProblems.length ?? null,
      grade: outcome.grade
        ? {
            intro: outcome.grade.issue.intro_unsupported_claims,
            stories: outcome.grade.issue.stories.map((story) => ({
              id: story.story_id,
              claims: story.unsupported_claims,
              distinct: story.bullets.filter((bullet) => bullet.distinct_from_detail).length,
              fromArticle: story.bullets.filter((bullet) => bullet.from_article_text).length,
              note: story.note,
            })),
            quality: outcome.grade.issue.editorial_quality,
            vsGolden: outcome.grade.vsGolden,
          }
        : null,
      title: outcome.output?.first.title ?? null,
    }),
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
