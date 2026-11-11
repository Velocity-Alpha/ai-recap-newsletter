// The scene prompt (src/pipeline/draft/image/scene-prompt.ts) on 10 past issues. evals/README.md.
import { expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type RunContext } from "@/evals/lib/sweep";
import { loadSceneIssues, SCENE_ISSUE_DATES, type SceneIssue } from "@/evals/scene-prompt/issues";
import { issueForJudge, SCENE_PROMPT_JUDGE_INSTRUCTIONS, SCENE_PROMPT_JUDGE_SCHEMA } from "@/evals/scene-prompt/rubric";
import { checkScenePrompt, scoreScenePrompt, type ScenePromptGrade, type ScenePromptOutput } from "@/evals/scene-prompt/score";
import { SCENE_PROMPT_MODEL, writeScenePrompt } from "@/src/pipeline/draft/image/scene-prompt";

async function write(item: SceneIssue, context: RunContext): Promise<ScenePromptOutput> {
  const started = performance.now();
  const { scenePrompt, rationale } = await writeScenePrompt(item.context, {
    client: context.client,
    model: context.config.model,
    effort: context.config.effort,
  });
  const callMs = performance.now() - started;
  // A judge failure is not the model's error: the run keeps its checks and has no grade.
  const grade = await context
    .judge<ScenePromptGrade>({
      name: "scene_prompt_grade",
      instructions: SCENE_PROMPT_JUDGE_INSTRUCTIONS,
      input: `${issueForJudge(item.context)}\n\nScene prompt to grade:\n${scenePrompt}`,
      schema: SCENE_PROMPT_JUDGE_SCHEMA,
    })
    .catch(() => null);
  return { scenePrompt, rationale, callMs, grade };
}

it("scene prompt: hard rules and judged rules", async () => {
  const settings = evalSettings({ model: SCENE_PROMPT_MODEL, efforts: ["none", "low", "medium", "high", undefined], repeats: 2 });
  const items = await loadSceneIssues();

  const { rows, path } = await runSweep({
    task: "scene-prompt",
    title: "Scene prompt eval",
    notes: [
      `The scene prompt of the featured image on the ${items.length} published issues of ${SCENE_ISSUE_DATES.from} to ` +
        `${SCENE_ISSUE_DATES.to}, read from the Neon dev branch (read-only): the subject line and the Top Stories, as ` +
        "`imageContextFor` builds them. No ground truth: the scores are the prompt's own rules.",
      "Deterministic checks (score.ts): '16:9' exactly once, 200–300 words, foreground/midground/background named, " +
        "camera angle and distance, lighting, none of the forbidden interpretive or style words, a rationale of " +
        "1–2 sentences and 45 words or fewer. 'All hard rules' is every check but the rationale.",
      "J: columns are the judge's grade (rubric.ts), counted over all runs; a run the judge could not grade is a miss " +
        "(see 'Judged'). 'Depicts lead': the scene shows the top story the subject line is about.",
      "Call p50/p95: the call site alone (up to 3 attempts). The p50/p95 columns include the judge.",
    ],
    settings,
    items,
    id: (item) => item.date,
    run: write,
    score: scoreScenePrompt,
    raw: (outcome) => {
      if (!outcome.output) return {};
      const checks = checkScenePrompt(outcome.output);
      return {
        issueId: outcome.item.issueId,
        subjectLine: outcome.item.context.subjectLine,
        callMs: Math.round(outcome.output.callMs),
        checks,
        grade: outcome.output.grade,
        // The model's own text, for reading the grades. evals/out is gitignored.
        scenePrompt: outcome.output.scenePrompt,
      };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
