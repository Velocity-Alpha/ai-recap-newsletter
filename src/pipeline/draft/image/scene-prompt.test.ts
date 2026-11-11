import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  buildSceneContext,
  buildScenePromptInput,
  SCENE_PROMPT_EFFORT,
  SCENE_PROMPT_MODEL,
  SCENE_PROMPT_TIMEOUT_MS,
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

const SCENE = "A small brass robot stands on a wooden desk, seen from eye level at medium distance.";
const OUTPUT = JSON.stringify({ image_prompt: `  ${SCENE}  `, editorial_rationale: "The robot is easy to draw." });

function fakeClient(...outputs: Array<string | Error>) {
  const create = vi.fn<(request: unknown, options?: unknown) => Promise<{ output_text: string }>>(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { output_text: next ?? "" };
  });
  return { client: { responses: { create } }, create };
}

describe("buildSceneContext", () => {
  it("fills n8n's context template with the subject line and the top stories as compact JSON", () => {
    const context = buildSceneContext(CONTEXT);

    expect(context.startsWith("You will receive a summary for a newsletter issue.")).toBe(true);
    expect(context).toContain("Important: Focus on the main topic from the subject line of the email");
    expect(context).toContain("Subject Line: Example Labs Ships a Tiny Robot\n\nTop Stories:\n\n");
    expect(context.endsWith(JSON.stringify(CONTEXT.topStories.map(({ headline, detail }) => ({ headline, detail }))))).toBe(
      true,
    );
  });

  it("sends only the headline and detail of each story", () => {
    const extra = { ...CONTEXT, topStories: [{ headline: "H", detail: "D", url: "https://example.org" }] };
    expect(buildSceneContext(extra)).toContain('[{"headline":"H","detail":"D"}]');
  });
});

describe("buildScenePromptInput", () => {
  it("puts 2.2.1's scene requirements before the context", () => {
    const input = buildScenePromptInput(CONTEXT);
    expect(input.startsWith("Dynamic scene requirements for image_prompt:")).toBe(true);
    expect(input).toContain("* Prefer scenes with simpler composition.\n\nYou will receive a summary");
  });
});

describe("writeScenePrompt", () => {
  async function sentCall() {
    const { client, create } = fakeClient(OUTPUT);
    await writeScenePrompt(CONTEXT, { client, retryDelayMs: 0 });
    expect(create).toHaveBeenCalledOnce();
    const [request, requestOptions] = create.mock.calls[0] as [
      Record<string, unknown> & { text: { format: Record<string, unknown> & { schema: Record<string, unknown> } } },
      Record<string, unknown>,
    ];
    return { request, requestOptions };
  }

  it("returns the trimmed scene and rationale", async () => {
    const { client } = fakeClient(OUTPUT);
    await expect(writeScenePrompt(CONTEXT, { client, retryDelayMs: 0 })).resolves.toEqual({
      scenePrompt: SCENE,
      rationale: "The robot is easy to draw.",
    });
  });

  it("calls gpt-6-luna", async () => {
    expect(SCENE_PROMPT_MODEL).toBe("gpt-6-luna");
    expect((await sentCall()).request.model).toBe("gpt-6-luna");
  });

  it("calls at medium effort", async () => {
    expect(SCENE_PROMPT_EFFORT).toBe("medium");
    expect((await sentCall()).request.reasoning).toEqual({ effort: "medium" });
  });

  it("sends 2.2.1's instructions and the context as input", async () => {
    const { request } = await sentCall();
    expect(request.instructions).toMatch(/^You are an editorial image creative director/);
    expect(request.input).toBe(buildScenePromptInput(CONTEXT));
  });

  it("sends the same instructions, input and schema bytes as before the prompt was split into named parts", async () => {
    const { request } = await sentCall();
    const sha = (text: string) => createHash("sha256").update(text).digest("hex");
    expect([sha(String(request.instructions)), sha(String(request.input)), sha(JSON.stringify(request.text))]).toEqual([
      "6cffaaf7c83b8e2cc08ade527e6219fd0cc21c2fc6010b300fbf050f69024036",
      "fa77a9368d3be27046007d6e66b376c724e104865aae774d2b574e2b7a3caa80",
      "5bfa2b327443380391dcde8d43390c8e89e266ec9b46c685836d35a7866dcea1",
    ]);
  });

  it("uses no web search", async () => {
    expect((await sentCall()).request.tools).toBeUndefined();
  });

  it("stores nothing", async () => {
    expect((await sentCall()).request.store).toBe(false);
  });

  it("asks for 2.2.1's strict JSON", async () => {
    const { request } = await sentCall();
    expect(request.text.format).toMatchObject({ type: "json_schema", name: "image_prompt_output", strict: true });
    expect(request.text.format.schema).toMatchObject({
      required: ["image_prompt", "editorial_rationale"],
      additionalProperties: false,
    });
  });

  it("gives the call a 120 s timeout and no SDK retry", async () => {
    expect(SCENE_PROMPT_TIMEOUT_MS).toBe(120_000);
    // Our loop does the retries, so the SDK must not retry on top of it.
    expect((await sentCall()).requestOptions).toEqual({ timeout: 120_000, maxRetries: 0 });
  });

  it("uses the model and effort it is given (for evals)", async () => {
    const { client, create } = fakeClient(OUTPUT);
    await writeScenePrompt(CONTEXT, { client, retryDelayMs: 0, model: "gpt-6-sol", effort: "low" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "low" } });
  });

  it("retries twice, for a failed call or output that does not match the schema", async () => {
    const { client, create } = fakeClient(new Error("Request timed out."), "not json", OUTPUT);

    await expect(writeScenePrompt(CONTEXT, { client, retryDelayMs: 0 })).resolves.toMatchObject({ scenePrompt: SCENE });
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("gives up after 3 attempts and reports the last error", async () => {
    const { client, create } = fakeClient(
      new Error("HTTP 500"),
      new Error("HTTP 500"),
      JSON.stringify({ image_prompt: " ", editorial_rationale: "x" }),
    );

    await expect(writeScenePrompt(CONTEXT, { client, retryDelayMs: 0 })).rejects.toThrow(
      "Scene prompt failed after 3 attempts: model output has an empty image_prompt.",
    );
    expect(create).toHaveBeenCalledTimes(3);
  });

  it("refuses an issue with no subject line or no top stories, without calling the model", async () => {
    const { client, create } = fakeClient(OUTPUT);

    await expect(writeScenePrompt({ ...CONTEXT, subjectLine: " " }, { client })).rejects.toThrow("subject line");
    await expect(writeScenePrompt({ ...CONTEXT, topStories: [] }, { client })).rejects.toThrow("top stories");
    expect(create).not.toHaveBeenCalled();
  });
});
