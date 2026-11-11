import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { parseSceneIdeas, SCENE_IDEAS_EFFORT, SCENE_IDEAS_TIMEOUT_MS, suggestSceneIdeas } from "@/src/pipeline/draft/image/scene-ideas";
import { buildSceneContext, SCENE_PROMPT_MODEL, type ScenePromptContext } from "@/src/pipeline/draft/image/scene-prompt";

const CONTEXT: ScenePromptContext = {
  subjectLine: "Example Labs Ships a Tiny Robot",
  topStories: [
    { headline: "Example Labs Ships a Tiny Robot", detail: "A synthetic story detail." },
    { headline: "Sample Corp Opens a Research Lab", detail: "Another synthetic detail." },
  ],
};

const IDEAS = [
  { label: "Robot on a desk", scene: "A small brass robot stands on a wooden desk, seen at eye level." },
  { label: "Lab doors open", scene: "Two glass doors swing open onto a bright empty lab, seen from low down." },
  { label: "Robot and lamp", scene: "A tiny robot reaches for the switch of a desk lamp, seen from above." },
];

function fakeClient(...outputs: Array<string | Error>) {
  const create = vi.fn<(request: unknown, options?: unknown) => Promise<{ output_text: string }>>(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { output_text: next ?? "" };
  });
  return { client: { responses: { create } }, create };
}

describe("suggestSceneIdeas", () => {
  it("asks GPT-6 Luna once for three scenes from the subject line and top stories", async () => {
    const { client, create } = fakeClient(JSON.stringify({ ideas: IDEAS }));

    const ideas = await suggestSceneIdeas(CONTEXT, { client });

    expect(ideas).toEqual(IDEAS);
    expect(create).toHaveBeenCalledTimes(1);
    const [request, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(request).toMatchObject({
      model: SCENE_PROMPT_MODEL,
      store: false,
      text: { format: { type: "json_schema", strict: true } },
    });
    expect(SCENE_IDEAS_EFFORT).toBe("medium");
    expect(request.reasoning).toEqual({ effort: "medium" });
    expect(String(request.input)).toContain(buildSceneContext(CONTEXT));
    expect(String(request.instructions)).toContain("three");
    // The board waits for this, so there are no retries, and it ends inside Netlify's 60 s.
    expect(options).toEqual({ timeout: SCENE_IDEAS_TIMEOUT_MS, maxRetries: 0 });
    expect(SCENE_IDEAS_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("sends the same instructions, input and schema bytes as before the prompt was split into named parts", async () => {
    const { client, create } = fakeClient(JSON.stringify({ ideas: IDEAS }));
    await suggestSceneIdeas(CONTEXT, { client });
    const [request] = create.mock.calls[0] as [Record<string, unknown>];
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    expect([sha(String(request.instructions)), sha(String(request.input)), sha(JSON.stringify(request.text))]).toEqual([
      "7e2dcad877e694528e1b307f2115a7e65d2fcc14772bf8df70966696ef9e22d4",
      "a34121b7cba5b74a8a1660be4617c67721242320d90e7e727379998df9b2afd9",
      "9e91eaae6723cd96415aa302fb6693dc09342ba555d744c1d56c016641a072a1",
    ]);
  });

  it("uses the model and effort it is given (for evals)", async () => {
    const { client, create } = fakeClient(JSON.stringify({ ideas: IDEAS }));
    await suggestSceneIdeas(CONTEXT, { client, model: "gpt-6-sol", effort: "none" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "none" } });
  });

  it("refuses an issue with no subject line or no top stories, without calling the model", async () => {
    const { client, create } = fakeClient();

    await expect(suggestSceneIdeas({ ...CONTEXT, subjectLine: " " }, { client })).rejects.toThrow("subject line");
    await expect(suggestSceneIdeas({ ...CONTEXT, topStories: [] }, { client })).rejects.toThrow("top stories");
    expect(create).not.toHaveBeenCalled();
  });

  it("reports the model's error plainly", async () => {
    const { client } = fakeClient(new Error("Request timed out."));

    await expect(suggestSceneIdeas(CONTEXT, { client })).rejects.toThrow("Scene ideas failed: Request timed out.");
  });
});

describe("parseSceneIdeas", () => {
  it("trims each idea, drops empty ones, and keeps at most three", () => {
    const output = JSON.stringify({
      ideas: [
        { label: "  One ", scene: " First scene. " },
        { label: "", scene: "No label." },
        { label: "Two", scene: "Second scene." },
        { label: "Three", scene: "Third scene." },
        { label: "Four", scene: "Fourth scene." },
      ],
    });

    expect(parseSceneIdeas(output)).toEqual([
      { label: "One", scene: "First scene." },
      { label: "Two", scene: "Second scene." },
      { label: "Three", scene: "Third scene." },
    ]);
  });

  it.each([
    ["not JSON", "nope", "not valid JSON"],
    ["no ideas", JSON.stringify({ ideas: [] }), "no scene ideas"],
    ["no ideas key", JSON.stringify({ scenes: IDEAS }), "no scene ideas"],
  ])("fails on %s", (_name, output, message) => {
    expect(() => parseSceneIdeas(output)).toThrow(message);
  });
});
