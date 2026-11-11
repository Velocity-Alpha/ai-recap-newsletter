// The issue writer (src/pipeline/draft/writer.ts) on 6 past issues from the Neon dev branch. evals/README.md.
import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { effortLabel, evalSettings } from "@/evals/lib/settings";
import { mapLimit } from "@/evals/lib/concurrency";
import { runSweep, type AfterSweepContext, type ConfigOutcomes, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { articleCoverage, loadCases, type WriterCase } from "@/evals/writer/dataset";
import { EVAL_NOTES, withEvalNotes } from "@/evals/writer/notes";
import {
  GRADE_INSTRUCTIONS,
  GRADE_SCHEMA,
  gradeInput,
  PAIR_INSTRUCTIONS,
  PAIR_SCHEMA,
  pairInput,
  type IssueGrade,
  type PairGrade,
} from "@/evals/writer/rubric";
import { pairMetrics, scoreWriter, writerColumns, type PairResult, type WriterRun } from "@/evals/writer/score";
import { findContentProblems } from "@/src/pipeline/draft/validate";
import { createOpenAIIssueWriter, WRITER_EFFORT, WRITER_MODEL } from "@/src/pipeline/draft/writer";

/** The pairwise baseline: production's effort. */
const BASELINE = WRITER_EFFORT;
const BASELINE_NAME = effortLabel(BASELINE);
/** Pairwise grades only on the first repeat, to keep the judge's cost down. */
const PAIR_REPEATS = 1;

/** Draft A or B for this effort: a fixed coin per issue, repeat and effort, so a rerun asks the same question. */
function thisFirst(item: WriterCase, repeat: number, effort: string): boolean {
  return createHash("sha256").update(`${item.date}|${repeat}|${effort}`).digest()[0] % 2 === 0;
}

/** One draft as production makes it: write, check, and one rewrite with the problems when a check fails. */
async function write(item: WriterCase, context: RunContext): Promise<WriterRun> {
  const { model, effort } = context.config;
  const writer = createOpenAIIssueWriter({ client: context.client, model, effort });
  const { input } = withEvalNotes(item.input);

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

function grade(item: WriterCase, output: WriterRun, context: GradeContext): Promise<IssueGrade> {
  const { input } = withEvalNotes(item.input);
  return context.judge<IssueGrade>({ name: "issue_grade", instructions: GRADE_INSTRUCTIONS, input: gradeInput(input, output.first), schema: GRADE_SCHEMA });
}

/**
 * The pairwise judge, once every effort ran: each effort's first draft against the baseline's of the same issue and
 * repeat (first PAIR_REPEATS repeats). No pairs when the sweep has no baseline config.
 */
async function comparePairs(configs: ConfigOutcomes<WriterCase, WriterRun, IssueGrade>[], context: AfterSweepContext, concurrency: number) {
  const baseline = configs.find((entry) => entry.config.effort === BASELINE);
  return Promise.all(
    configs.map(async ({ config, outcomes }) => {
      if (!baseline || config === baseline.config) return { metrics: [] };
      const judge = context.judgeFor(config);
      const effortName = effortLabel(config.effort);
      const pairs = outcomes.flatMap((outcome) => {
        const other = baseline.outcomes.find((entry) => entry.id === outcome.id && entry.repeat === outcome.repeat);
        return outcome.repeat < PAIR_REPEATS && outcome.output && other?.output ? [{ outcome, mine: outcome.output.first, theirs: other.output.first }] : [];
      });
      const judged = await mapLimit(pairs, concurrency, async ({ outcome, mine, theirs }) => {
        const mineFirst = thisFirst(outcome.item, outcome.repeat, effortName);
        const [a, b] = mineFirst ? [mine, theirs] : [theirs, mine];
        try {
          const { input } = withEvalNotes(outcome.item.input);
          const verdict = await judge<PairGrade>({ name: "draft_preference", instructions: PAIR_INSTRUCTIONS, input: pairInput(input, a, b), schema: PAIR_SCHEMA });
          const result: PairResult = verdict.winner === "tie" ? "tie" : verdict.winner === (mineFirst ? "A" : "B") ? "win" : "loss";
          return { id: outcome.id, repeat: outcome.repeat, result, thisFirst: mineFirst };
        } catch (error) {
          console.warn(`[writer] ${outcome.id}: the pairwise judge failed: ${error instanceof Error ? error.message : String(error)}`);
          return { id: outcome.id, repeat: outcome.repeat, result: null, thisFirst: mineFirst };
        }
      });
      const results = judged.flatMap((entry) => (entry.result ? [entry.result] : []));
      return { metrics: pairMetrics(results, BASELINE_NAME), raw: judged };
    })
  );
}

it("writer: code checks and judge grades of each effort", async () => {
  const settings = evalSettings({ model: WRITER_MODEL, efforts: [BASELINE, "none", "medium", "high"], repeats: 2, concurrency: 6 });
  const cases = loadCases();
  const coverage = articleCoverage(cases);

  const { rows, path } = await runSweep({
    task: "writer",
    title: "Issue writer eval",
    notes: [
      `The issue writer on ${cases.length} issues (${cases.map((item) => item.date).join(", ")}; evals/writer/manifest.json), ` +
        "built by evals/writer/build-dataset.ts from the Neon dev branch (read-only) as drafting builds the writer's input. " +
        "Sections and board order: issue_stories (the sent email) for published issues, the board's commit for 2026-11-09 (a draft).",
      `Article text for the ${coverage.features} feature stories: ${coverage.saved} saved copies (story_articles), ` +
        `${coverage.read} read by the repo's article reader on the build day, ${coverage.unread} not read (summaries only).`,
      `No issue had owner notes, so the eval adds ${EVAL_NOTES.length} of its own to each issue (evals/writer/notes.ts), each checked in code.`,
      "Every metric reads the first draft, except \"Checks pass after rewrite\", which runs production's one rewrite. " +
        "Cost per call and p50/p95 include the rewrites; p50/p95 are the writer calls alone (the writer times out at " +
        "240 s in production). Rows with git sha 035179c+changes (before d1da5b8) timed the judge in p50/p95 too, and " +
        "have the writer calls alone in \"Writer p50 s\" and \"Writer max s\".",
      "Judge: gpt-6-sol (high) grades each first draft against the writer's exact input (evals/writer/rubric.ts): unsupported " +
        "claims counted per story, each bullet, each note, and editorial quality on anchored 1-5; (judge) counts are over " +
        "the graded runs. The pairwise judge sees both drafts in random order without the article text; once all efforts " +
        `ran, each is compared with ${BASELINE_NAME} (production's effort) on the same issue, first repeat only. Rows with ` +
        "git sha 035179c+changes were compared with low. The table shows chosen columns; all metrics are in the stored rows.",
    ],
    settings,
    items: cases,
    id: (item) => item.date,
    run: write,
    grade,
    score: scoreWriter,
    afterSweep: (configs, context) => comparePairs(configs, context, settings.concurrency),
    columns: writerColumns(BASELINE_NAME),
    raw: (outcome) => ({
      firstProblems: outcome.output?.firstProblems.length ?? null,
      finalProblems: outcome.output?.finalProblems.length ?? null,
      grade: outcome.grade
        ? {
            intro: outcome.grade.intro_unsupported_claims,
            stories: outcome.grade.stories.map((story) => ({
              id: story.story_id,
              claims: story.unsupported_claims,
              distinct: story.bullets.filter((bullet) => bullet.distinct_from_detail).length,
              fromArticle: story.bullets.filter((bullet) => bullet.from_article_text).length,
              note: story.note,
            })),
            quality: outcome.grade.editorial_quality,
          }
        : null,
      title: outcome.output?.first.title ?? null,
    }),
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
