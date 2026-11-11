import { describe, expect, it, vi } from "vitest";

import { SCENE_IDEAS_JUDGE_INSTRUCTIONS } from "@/evals/scene-ideas/rubric";
import { SCENE_PROMPT_JUDGE_INSTRUCTIONS } from "@/evals/scene-prompt/rubric";
import { issueForJudge, SCENE_IDEAS_RULE_TEXTS, SCENE_PROMPT_RULE_TEXTS, type SceneRuleTexts } from "@/evals/scenes/rubric";
import { checkSceneText, INTERPRETIVE_SCENE_IDEAS } from "@/evals/scenes/rules";
import { SCENE_IDEAS_DIFFERENT, SCENE_IDEAS_INTERPRETIVE_WORDS, suggestSceneIdeas } from "@/src/pipeline/draft/image/scene-ideas";
import {
  SCENE_LAYERS,
  SCENE_PROMPT_INTERPRETIVE_WORDS,
  SCENE_STYLE_WORDS,
  writeScenePrompt,
  type ScenePromptContext,
} from "@/src/pipeline/draft/image/scene-prompt";

const CONTEXT: ScenePromptContext = {
  subjectLine: "Example Labs Ships a Tiny Robot",
  topStories: [
    { headline: "Example Labs Ships a Tiny Robot", detail: "A synthetic story detail." },
    { headline: "Sample Corp Opens a Research Lab", detail: "Another synthetic detail." },
  ],
};

/** What a call site sends: its instructions and input, from a fake client. */
async function sent(call: "prompt" | "ideas"): Promise<string> {
  const output = JSON.stringify({ image_prompt: "x", editorial_rationale: "y", ideas: [{ label: "a b", scene: "c" }] });
  const create = vi.fn<(request: unknown) => Promise<{ output_text: string }>>(async () => ({ output_text: output }));
  const client = { responses: { create } } as never;
  if (call === "prompt") await writeScenePrompt(CONTEXT, { client, retryDelayMs: 0 });
  else await suggestSceneIdeas(CONTEXT, { client });
  const request = create.mock.calls[0][0] as { instructions: string; input: string };
  return `${request.instructions}\n${request.input}`;
}

const allTexts = (rules: SceneRuleTexts) => Object.values(rules).flat() as string[];

describe("the scene rubrics quote the prompts the app sends", () => {
  it("every rule the scene prompt's rubric quotes is in the scene prompt's request, and in the judge's instructions", async () => {
    const request = await sent("prompt");
    for (const text of allTexts(SCENE_PROMPT_RULE_TEXTS)) {
      expect(request).toContain(text);
      expect(SCENE_PROMPT_JUDGE_INSTRUCTIONS).toContain(text);
    }
  });

  it("every rule the scene ideas' rubric quotes is in the scene ideas' request, and in the judge's instructions", async () => {
    const request = await sent("ideas");
    for (const text of allTexts(SCENE_IDEAS_RULE_TEXTS)) {
      expect(request).toContain(text);
      expect(SCENE_IDEAS_JUDGE_INSTRUCTIONS).toContain(text);
    }
    expect(request).toContain(SCENE_IDEAS_DIFFERENT);
    expect(SCENE_IDEAS_JUDGE_INSTRUCTIONS).toContain(SCENE_IDEAS_DIFFERENT);
  });

  it("the checks' word lists and layers are the ones each prompt states", async () => {
    const prompt = await sent("prompt");
    const ideas = await sent("ideas");
    expect(prompt).toContain(SCENE_PROMPT_INTERPRETIVE_WORDS.join(", "));
    expect(ideas).toContain(SCENE_IDEAS_INTERPRETIVE_WORDS.join(", "));
    for (const request of [prompt, ideas]) {
      expect(request).toContain(SCENE_STYLE_WORDS.join(", "));
      expect(request).toContain(SCENE_LAYERS.join(", "));
    }
  });

  it("the checks find every word each prompt forbids", () => {
    expect(checkSceneText(SCENE_PROMPT_INTERPRETIVE_WORDS.join(" ")).interpretiveWords).toHaveLength(SCENE_PROMPT_INTERPRETIVE_WORDS.length);
    expect(checkSceneText(SCENE_IDEAS_INTERPRETIVE_WORDS.join(" "), INTERPRETIVE_SCENE_IDEAS).interpretiveWords).toHaveLength(
      SCENE_IDEAS_INTERPRETIVE_WORDS.length
    );
    expect(checkSceneText(SCENE_STYLE_WORDS.join(" ")).styleWords).toHaveLength(SCENE_STYLE_WORDS.length);
  });
});

describe("issueForJudge", () => {
  it("gives the judge the golden lead story, its identifiers and misreads", () => {
    const text = issueForJudge(CONTEXT, { lead_story: 2, identifiers: ["Sample Corp", "lab door"], forbidden_misreads: ["a robot"] });
    expect(text).toContain("Lead story (given): 2. Sample Corp Opens a Research Lab");
    expect(text).toContain("should show: Sample Corp; lab door");
    expect(text).toContain("Misreads of the lead story: a robot");
  });

  it("says so when the golden value has no misreads", () => {
    expect(issueForJudge(CONTEXT, { lead_story: 1, identifiers: ["Example Labs"] })).toContain("Misreads of the lead story: none given");
  });
});
