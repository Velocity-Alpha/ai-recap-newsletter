// The scene prompt (src/pipeline/draft/image/scene-prompt.ts) on the published issues of evals/scenes/issues.json. evals/README.md.
import { expect, it } from "vitest";

import type { Golden } from "@/evals/lib/golden";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { SCENE_PROMPT_JUDGE_INSTRUCTIONS, SCENE_PROMPT_JUDGE_SCHEMA } from "@/evals/scene-prompt/rubric";
import {
  checkScenePrompt,
  scoreScenePrompt,
  type ScenePromptGrade,
  type ScenePromptJudgeAnswer,
  type ScenePromptOutput,
} from "@/evals/scene-prompt/score";
import { readSceneGolden, SCENE_GOLDEN_PATH, sceneGoldenFor, sceneItemId, type SceneGolden } from "@/evals/scenes/golden";
import { readSceneIssues, SCENE_ISSUES_PATH, type SceneIssue } from "@/evals/scenes/issues";
import { issueForJudge } from "@/evals/scenes/rubric";
import { SCENE_PROMPT_EFFORT, SCENE_PROMPT_MODEL, writeScenePrompt } from "@/src/pipeline/draft/image/scene-prompt";

function write(item: SceneIssue, context: RunContext): Promise<ScenePromptOutput> {
  return writeScenePrompt(item.context, { client: context.client, model: context.config.model, effort: context.config.effort });
}

/** A judge failure is not the model's error: the run keeps its checks and has no grade. */
async function grade(
  golden: Golden<SceneGolden>,
  item: SceneIssue,
  output: ScenePromptOutput,
  context: GradeContext
): Promise<ScenePromptGrade> {
  const value = sceneGoldenFor(golden, item);
  const answer = await context.judge<ScenePromptJudgeAnswer>({
    name: "scene_prompt_grade",
    instructions: SCENE_PROMPT_JUDGE_INSTRUCTIONS,
    input: `${issueForJudge(item.context, value)}\n\nScene prompt to grade:\n${output.scenePrompt}`,
    schema: SCENE_PROMPT_JUDGE_SCHEMA,
  });
  return { ...answer, lead_story: value.lead_story };
}

it("scene prompt: hard rules and judged rules", async () => {
  const settings = evalSettings({
    model: SCENE_PROMPT_MODEL,
    efforts: ["none", "low", "medium", "high"],
    repeats: 2,
    baseline: SCENE_PROMPT_EFFORT,
  });
  const { from, to, issues: items } = readSceneIssues();
  // Refuses to start while an issue of the run has no current golden value.
  const golden = readSceneGolden(settings.limit ? items.slice(0, settings.limit) : items);

  const { rows, path } = await runSweep({
    task: "scene-prompt",
    title: "Scene prompt eval",
    notes: [
      `The scene prompt of the featured image on ${items.length} published issues of ${from} to ${to} ` +
        `(\`${SCENE_ISSUES_PATH}\`, built from the Neon dev branch): the subject line and the Top Stories, as ` +
        "`imageContextFor` builds them. The rule scores are the prompt's own rules; the lead is scored against golden " +
        `values (\`${SCENE_GOLDEN_PATH}\`, made by Claude Opus from the same text, evals/scenes/golden-todo.md): the lead ` +
        "story and 1–4 identifiers of its news.",
      "Deterministic checks (score.ts): '16:9' exactly once, 200–300 words, foreground/midground/background named, " +
        "camera angle and distance, lighting, none of the forbidden interpretive or style words, a rationale of " +
        "1–2 sentences and 45 words or fewer. 'All hard rules' is every check but the rationale. The numbers and word " +
        "lists are imported from the call site.",
      "J: columns are the judge's grade (rubric.ts, which quotes the prompt's rules), counted over the runs it graded " +
        "(the Graded column). The judge is given the golden lead story and its identifiers. 'Depicts lead': the scene " +
        "shows the golden lead; 'shows a lead identifier': and visibly shows one of its identifiers; 'no misread': it " +
        "shows none of the golden misreads.",
      "p50/p95: the call site alone (up to 3 attempts).",
    ],
    settings,
    items,
    id: sceneItemId,
    run: write,
    grade: (item, output, context) => grade(golden, item, output, context),
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
