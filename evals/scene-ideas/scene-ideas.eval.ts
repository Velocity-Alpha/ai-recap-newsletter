// The scene ideas of "New image" (src/pipeline/draft/image/scene-ideas.ts) on 10 past issues. evals/README.md.
import { expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { ideasForJudge, SCENE_IDEAS_JUDGE_INSTRUCTIONS, SCENE_IDEAS_JUDGE_SCHEMA } from "@/evals/scene-ideas/rubric";
import { checkIdea, rawIdeaCount, scoreSceneIdeas, type SceneIdeasGrade, type SceneIdeasOutput } from "@/evals/scene-ideas/score";
import { loadSceneIssues, SCENE_ISSUE_DATES, type SceneIssue } from "@/evals/scene-prompt/issues";
import { issueForJudge } from "@/evals/scene-prompt/rubric";
import { SCENE_IDEAS_TIMEOUT_MS, suggestSceneIdeas } from "@/src/pipeline/draft/image/scene-ideas";
import { SCENE_PROMPT_MODEL } from "@/src/pipeline/draft/image/scene-prompt";

async function suggest(item: SceneIssue, context: RunContext): Promise<SceneIdeasOutput> {
  const ideas = await suggestSceneIdeas(item.context, { client: context.client, model: context.config.model, effort: context.config.effort });
  // The raw answer: the call site drops ideas past the third.
  return { ideas, rawIdeaCount: rawIdeaCount(context.responses().at(-1)?.output_text ?? "") };
}

/** A judge failure is not the model's error: the run keeps its checks and has no grade. */
function grade(item: SceneIssue, output: SceneIdeasOutput, context: GradeContext): Promise<SceneIdeasGrade> {
  return context.judge<SceneIdeasGrade>({
    name: "scene_ideas_grade",
    instructions: SCENE_IDEAS_JUDGE_INSTRUCTIONS,
    input: `${issueForJudge(item.context)}\n\nScene ideas to grade:\n\n${ideasForJudge(output.ideas)}`,
    schema: SCENE_IDEAS_JUDGE_SCHEMA,
  });
}

it("scene ideas: hard rules, judged rules, and latency against the route's timeout", async () => {
  const settings = evalSettings({ model: SCENE_PROMPT_MODEL, efforts: ["none", "low", "medium", "high", undefined], repeats: 2 });
  const items = await loadSceneIssues();

  const { rows, path } = await runSweep({
    task: "scene-ideas",
    title: "Scene ideas eval",
    notes: [
      `The three scene ideas of "New image" on the ${items.length} published issues of ${SCENE_ISSUE_DATES.from} to ` +
        `${SCENE_ISSUE_DATES.to}, read from the Neon dev branch (read-only), with the context the board builds ` +
        "(`imageContextFor`). No ground truth: the scores are the prompt's own rules.",
      "Run columns are of n runs; 'Idea:' and judged idea columns are of 3 ideas per run (a missing idea or an error " +
        "is a miss). Hard rules (score.ts): exactly 3 ideas in the answer, 120–200 words, a label of 2–6 words, " +
        "foreground/midground/background, camera, lighting, none of the forbidden interpretive or style words.",
      "J: columns are the judge's grade (rubric.ts), over the runs it graded (the Graded column; judged idea columns " +
        "are of 3 ideas per graded run). 'An idea shows the lead': one idea shows the top story the subject line is about.",
      `The call runs in a web request with a ${SCENE_IDEAS_TIMEOUT_MS / 1000} s timeout and no retry: a slower call ` +
        `is an error. 'Done in ${SCENE_IDEAS_TIMEOUT_MS / 1000} s' and p50/p95 time the call alone. Rows from before ` +
        "2026-11-11 counted ungraded runs as J: misses, timed the judge in p50/p95, and have the call alone in 'Call p50 s' and 'Call p95 s'.",
    ],
    settings,
    items,
    id: (item) => item.date,
    run: suggest,
    grade,
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
