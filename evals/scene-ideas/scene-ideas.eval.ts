// The scene ideas of "New image" (src/pipeline/draft/image/scene-ideas.ts) on the published issues of evals/scenes/issues.json. evals/README.md.
import { expect, it } from "vitest";

import type { Golden } from "@/evals/lib/golden";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { ideasForJudge, SCENE_IDEAS_JUDGE_INSTRUCTIONS, SCENE_IDEAS_JUDGE_SCHEMA } from "@/evals/scene-ideas/rubric";
import {
  checkIdea,
  rawIdeaCount,
  scoreSceneIdeas,
  type SceneIdeasGrade,
  type SceneIdeasJudgeAnswer,
  type SceneIdeasOutput,
} from "@/evals/scene-ideas/score";
import { readSceneGolden, SCENE_GOLDEN_PATH, sceneGoldenFor, sceneItemId, type SceneGolden } from "@/evals/scenes/golden";
import { readSceneIssues, SCENE_ISSUES_PATH, type SceneIssue } from "@/evals/scenes/issues";
import { issueForJudge } from "@/evals/scenes/rubric";
import { SCENE_IDEAS_EFFORT, SCENE_IDEAS_TIMEOUT_MS, suggestSceneIdeas } from "@/src/pipeline/draft/image/scene-ideas";
import { SCENE_PROMPT_MODEL } from "@/src/pipeline/draft/image/scene-prompt";

async function suggest(item: SceneIssue, context: RunContext): Promise<SceneIdeasOutput> {
  const ideas = await suggestSceneIdeas(item.context, { client: context.client, model: context.config.model, effort: context.config.effort });
  // The raw answer: the call site drops ideas past the third.
  return { ideas, rawIdeaCount: rawIdeaCount(context.responses().at(-1)?.output_text ?? "") };
}

/** A judge failure is not the model's error: the run keeps its checks and has no grade. */
async function grade(
  golden: Golden<SceneGolden>,
  item: SceneIssue,
  output: SceneIdeasOutput,
  context: GradeContext
): Promise<SceneIdeasGrade> {
  const value = sceneGoldenFor(golden, item);
  const answer = await context.judge<SceneIdeasJudgeAnswer>({
    name: "scene_ideas_grade",
    instructions: SCENE_IDEAS_JUDGE_INSTRUCTIONS,
    input: `${issueForJudge(item.context, value)}\n\nScene ideas to grade:\n\n${ideasForJudge(output.ideas)}`,
    schema: SCENE_IDEAS_JUDGE_SCHEMA,
  });
  return { ...answer, lead_story: value.lead_story };
}

it("scene ideas: hard rules, judged rules, and latency against the route's timeout", async () => {
  const settings = evalSettings({
    model: SCENE_PROMPT_MODEL,
    efforts: ["none", "low", "medium", "high"],
    repeats: 2,
    baseline: SCENE_IDEAS_EFFORT,
  });
  const { from, to, issues: items } = readSceneIssues();
  // Refuses to start while an issue of the run has no current golden value.
  const golden = readSceneGolden(settings.limit ? items.slice(0, settings.limit) : items);

  const { rows, path } = await runSweep({
    task: "scene-ideas",
    title: "Scene ideas eval",
    notes: [
      `The three scene ideas of "New image" on ${items.length} published issues of ${from} to ${to} ` +
        `(\`${SCENE_ISSUES_PATH}\`, built from the Neon dev branch), with the context the board builds ` +
        "(`imageContextFor`). The rule scores are the prompt's own rules; the lead is scored against golden values " +
        `(\`${SCENE_GOLDEN_PATH}\`, made by Claude Opus from the same text, evals/scenes/golden-todo.md).`,
      "Run columns are of n runs; 'Idea:' and judged idea columns are of 3 ideas per run (a missing idea or an error " +
        "is a miss). Hard rules (score.ts): exactly 3 ideas in the answer, 120–200 words, a label of 2–6 words, " +
        "foreground/midground/background, camera, lighting, none of the forbidden interpretive or style words. The " +
        "numbers and word lists are imported from the call site.",
      "J: columns are the judge's grade (rubric.ts, which quotes the prompt's rules), over the runs it graded (the " +
        "Graded column; judged idea columns are of 3 ideas per graded run). The judge is given the golden lead story " +
        "and its identifiers. 'An idea shows the lead': one idea shows the golden lead; 'an idea shows a lead " +
        "identifier': and visibly shows one of its identifiers. Rows from before the golden values (10 issues) had the " +
        "judge find the lead itself.",
      `The call runs in a web request with a ${SCENE_IDEAS_TIMEOUT_MS / 1000} s timeout and no retry: a slower call ` +
        `is an error. 'Done in ${SCENE_IDEAS_TIMEOUT_MS / 1000} s' and p50/p95 time the call alone. Rows with git sha ` +
        "035179c+changes (before d1da5b8) counted ungraded runs as J: misses, timed the judge in p50/p95, and have the call alone in 'Call p50 s' and 'Call p95 s'.",
    ],
    settings,
    items,
    id: sceneItemId,
    run: suggest,
    grade: (item, output, context) => grade(golden, item, output, context),
    score: scoreSceneIdeas,
    raw: (outcome) => {
      if (!outcome.output) return {};
      return {
        issueId: outcome.item.issueId,
        subjectLine: outcome.item.context.subjectLine,
        rawIdeaCount: outcome.output.rawIdeaCount,
        checks: outcome.output.ideas.map(checkIdea),
        grade: outcome.grade,
        // The model's own text, for reading the grades. evals/out is gitignored.
        ideas: outcome.output.ideas,
      };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
