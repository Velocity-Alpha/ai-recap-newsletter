// The scene prompt (src/pipeline/draft/image/scene-prompt.ts) on 10 past issues. evals/README.md.
import { expect, it } from "vitest";

import { API_DEFAULT, evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { SCENE_PROMPT_JUDGE_INSTRUCTIONS, SCENE_PROMPT_JUDGE_SCHEMA } from "@/evals/scene-prompt/rubric";
import { checkScenePrompt, scoreScenePrompt, type ScenePromptGrade, type ScenePromptOutput } from "@/evals/scene-prompt/score";
import { readSceneIssues, SCENE_ISSUES_PATH, type SceneIssue } from "@/evals/scenes/issues";
import { issueForJudge } from "@/evals/scenes/rubric";
import { SCENE_PROMPT_MODEL, writeScenePrompt } from "@/src/pipeline/draft/image/scene-prompt";

function write(item: SceneIssue, context: RunContext): Promise<ScenePromptOutput> {
  return writeScenePrompt(item.context, { client: context.client, model: context.config.model, effort: context.config.effort });
}

/** A judge failure is not the model's error: the run keeps its checks and has no grade. */
function grade(item: SceneIssue, output: ScenePromptOutput, context: GradeContext): Promise<ScenePromptGrade> {
  return context.judge<ScenePromptGrade>({
    name: "scene_prompt_grade",
    instructions: SCENE_PROMPT_JUDGE_INSTRUCTIONS,
    input: `${issueForJudge(item.context)}\n\nScene prompt to grade:\n${output.scenePrompt}`,
    schema: SCENE_PROMPT_JUDGE_SCHEMA,
  });
}

it("scene prompt: hard rules and judged rules", async () => {
  const settings = evalSettings({ model: SCENE_PROMPT_MODEL, efforts: ["none", "low", "medium", "high", API_DEFAULT], repeats: 2 });
  const { from, to, issues: items } = readSceneIssues();

  const { rows, path } = await runSweep({
    task: "scene-prompt",
    title: "Scene prompt eval",
    notes: [
      `The scene prompt of the featured image on the ${items.length} published issues of ${from} to ${to} ` +
        `(\`${SCENE_ISSUES_PATH}\`, built from the Neon dev branch): the subject line and the Top Stories, as ` +
        "`imageContextFor` builds them. No ground truth: the scores are the prompt's own rules.",
      "Deterministic checks (score.ts): '16:9' exactly once, 200–300 words, foreground/midground/background named, " +
        "camera angle and distance, lighting, none of the forbidden interpretive or style words, a rationale of " +
        "1–2 sentences and 45 words or fewer. 'All hard rules' is every check but the rationale.",
      "J: columns are the judge's grade (rubric.ts), counted over the runs it graded (the Graded column). " +
        "'Depicts lead': the scene shows the top story the subject line is about.",
      "p50/p95: the call site alone (up to 3 attempts). Rows with git sha 035179c+changes (before d1da5b8) counted a run the " +
        "judge could not grade as a J: miss, timed the judge in p50/p95, and have the call alone in 'Call p50 s' and 'Call p95 s'.",
    ],
    settings,
    items,
    id: (item) => item.date,
    run: write,
    grade,
    score: scoreScenePrompt,
    raw: (outcome) => {
      if (!outcome.output) return {};
      const checks = checkScenePrompt(outcome.output);
      return {
        issueId: outcome.item.issueId,
        subjectLine: outcome.item.context.subjectLine,
        checks,
        grade: outcome.grade,
        // The model's own text, for reading the grades. evals/out is gitignored.
        scenePrompt: outcome.output.scenePrompt,
      };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
