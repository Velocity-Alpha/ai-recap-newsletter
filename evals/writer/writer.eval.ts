// The issue writer (src/pipeline/draft/writer.ts) on 6 past issues from the Neon dev branch. evals/README.md.
import { createHash } from "node:crypto";

import { expect, it } from "vitest";

import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type RunContext } from "@/evals/lib/sweep";
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
import { scoreWriter, type WriterRun } from "@/evals/writer/score";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { findContentProblems } from "@/src/pipeline/draft/validate";
import { createOpenAIIssueWriter, WRITER_EFFORT, WRITER_MODEL } from "@/src/pipeline/draft/writer";

/** The pairwise baseline: production's effort. It runs first, so the other efforts can be compared with it. */
const BASELINE = WRITER_EFFORT;
/** Pairwise grades only on the first repeat, to keep the judge's cost down. */
const PAIR_REPEATS = 1;

/** Each baseline first draft, by model, issue and repeat. */
const baselineDrafts = new Map<string, WrittenIssueContent>();
const draftKey = (model: string, item: WriterCase, repeat: number) => `${model}|${item.date}|${repeat}`;

/** Draft A or B for this effort: a fixed coin per issue, repeat and effort, so a rerun asks the same question. */
function thisFirst(item: WriterCase, repeat: number, effort: string): boolean {
  return createHash("sha256").update(`${item.date}|${repeat}|${effort}`).digest()[0] % 2 === 0;
}

async function timed<T>(work: () => Promise<T>, times: number[]): Promise<T> {
  const started = performance.now();
  try {
    return await work();
  } finally {
    times.push(Math.round(performance.now() - started));
  }
}

/** One draft as production makes it: write, check, and one rewrite with the problems when a check fails. */
async function write(item: WriterCase, context: RunContext): Promise<WriterRun> {
  const { model, effort } = context.config;
  const writer = createOpenAIIssueWriter({ client: context.client, model, effort });
  const { input } = withEvalNotes(item.input);
  const writerMs: number[] = [];

  const first = await timed(() => writer(input), writerMs);
  const firstProblems = findContentProblems(first, input.sections);
  let finalProblems = firstProblems;
  if (firstProblems.length > 0) {
    try {
      const rewritten = await timed(() => writer({ ...input, revision: { previous: first, problems: firstProblems } }), writerMs);
      finalProblems = findContentProblems(rewritten, input.sections);
    } catch (error) {
      finalProblems = [`The rewrite failed: ${error instanceof Error ? error.message : String(error)}`];
    }
  }

  let grade: IssueGrade | null = null;
  try {
    grade = await context.judge<IssueGrade>({ name: "issue_grade", instructions: GRADE_INSTRUCTIONS, input: gradeInput(input, first), schema: GRADE_SCHEMA });
  } catch (error) {
    console.warn(`[writer] ${item.date}: the judge failed: ${error instanceof Error ? error.message : String(error)}`);
  }

  let pair: WriterRun["pair"] = null;
  const effortName = effort ?? "default";
  if (effort === BASELINE) {
    baselineDrafts.set(draftKey(model, item, context.repeat), first);
  } else if (context.repeat < PAIR_REPEATS) {
    const baseline = baselineDrafts.get(draftKey(model, item, context.repeat));
    if (baseline) {
      const mineFirst = thisFirst(item, context.repeat, effortName);
      const [a, b] = mineFirst ? [first, baseline] : [baseline, first];
      try {
        const verdict = await context.judge<PairGrade>({ name: "draft_preference", instructions: PAIR_INSTRUCTIONS, input: pairInput(input, a, b), schema: PAIR_SCHEMA });
        const mine = mineFirst ? "A" : "B";
        pair = { result: verdict.winner === "tie" ? "tie" : verdict.winner === mine ? "win" : "loss", thisFirst: mineFirst };
      } catch (error) {
        console.warn(`[writer] ${item.date}: the pairwise judge failed: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  return { first, firstProblems, finalProblems, writerMs, grade, pair };
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
        "Cost per call includes the rewrites. The p50 and p95 columns include the judge calls: the writer's own time is in " +
        "\"Writer p50 s\" and \"Writer max s\" (the writer times out at 240 s in production).",
      "Judge: gpt-6-sol (high) grades each first draft against the writer's exact input (evals/writer/rubric.ts): unsupported " +
        "claims counted per story, each bullet, each note, and editorial quality on anchored 1-5. The pairwise judge sees both " +
        `drafts in random order without the article text; each effort is compared with ${BASELINE} on the same issue, ` +
        `first repeat only (and only when ${BASELINE} runs first in the sweep).`,
    ],
    settings,
    items: cases,
    id: (item) => item.date,
    run: write,
    score: scoreWriter,
    raw: (outcome) => ({
      writerMs: outcome.output?.writerMs ?? null,
      firstProblems: outcome.output?.firstProblems.length ?? null,
      finalProblems: outcome.output?.finalProblems.length ?? null,
      grade: outcome.output?.grade
        ? {
            intro: outcome.output.grade.intro_unsupported_claims,
            stories: outcome.output.grade.stories.map((story) => ({
              id: story.story_id,
              claims: story.unsupported_claims,
              distinct: story.bullets.filter((bullet) => bullet.distinct_from_detail).length,
              fromArticle: story.bullets.filter((bullet) => bullet.from_article_text).length,
              note: story.note,
            })),
            quality: outcome.output.grade.editorial_quality,
          }
        : null,
      pair: outcome.output?.pair ?? null,
      title: outcome.output?.first.title ?? null,
    }),
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
