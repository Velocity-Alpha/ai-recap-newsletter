import { describe, expect, it, vi } from "vitest";

import { SCENE_IDEAS_COMPOSITION } from "@/src/pipeline/draft/image/scene-ideas";
import {
  buildSceneChatInput,
  parseSceneChatReply,
  SCENE_CHAT_EFFORT,
  SCENE_CHAT_TIMEOUT_MS,
  writeSceneFromChat,
  type SceneChatRequest,
} from "@/src/pipeline/draft/image/scene-chat";
import { SCENE_PROMPT_MODEL, SCENE_STYLE_WORDS } from "@/src/pipeline/draft/image/scene-prompt";

const REQUEST: SceneChatRequest = {
  scene: "",
  messages: [{ role: "owner", text: "A star and a sun circling each other." }],
};
const REPLY = { reply: "Two bodies in a slow orbit. Warm or cool light?", scene: "A small bright star and a larger sun circle each other, seen from far away." };

function fakeClient(...outputs: Array<string | Error>) {
  const create = vi.fn<(request: unknown, options?: unknown) => Promise<{ output_text: string }>>(async () => {
    const next = outputs.shift();
    if (next instanceof Error) throw next;
    return { output_text: next ?? "" };
  });
  return { client: { responses: { create } }, create };
}

describe("writeSceneFromChat", () => {
  it("asks GPT-6 Luna once for a reply and a scene prompt that follows the scene rules", async () => {
    const { client, create } = fakeClient(JSON.stringify(REPLY));

    expect(await writeSceneFromChat(REQUEST, { client })).toEqual(REPLY);

    expect(create).toHaveBeenCalledTimes(1);
    const [request, options] = create.mock.calls[0] as [Record<string, unknown>, Record<string, unknown>];
    expect(request).toMatchObject({ model: SCENE_PROMPT_MODEL, store: false, reasoning: { effort: SCENE_CHAT_EFFORT } });
    expect(request.text).toMatchObject({ format: { type: "json_schema", strict: true } });
    const instructions = String(request.instructions);
    for (const rule of Object.values(SCENE_IDEAS_COMPOSITION)) expect(instructions).toContain(rule);
    for (const word of SCENE_STYLE_WORDS) expect(instructions).toContain(word);
    expect(String(request.input)).toContain("A star and a sun circling each other.");
    // The board waits for this, so there are no retries, and it ends inside Netlify's 60 s.
    expect(options).toEqual({ timeout: SCENE_CHAT_TIMEOUT_MS, maxRetries: 0 });
    expect(SCENE_CHAT_TIMEOUT_MS).toBeLessThan(60_000);
  });

  it("uses the model and effort it is given (for evals)", async () => {
    const { client, create } = fakeClient(JSON.stringify(REPLY));
    await writeSceneFromChat(REQUEST, { client, model: "gpt-6-sol", effort: "none" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "none" } });
  });

  it("reports the model's error plainly", async () => {
    const { client } = fakeClient(new Error("Request timed out."));
    await expect(writeSceneFromChat(REQUEST, { client })).rejects.toThrow("Scene chat failed: Request timed out.");
  });
});

describe("buildSceneChatInput", () => {
  it("sends the scene to change, then the conversation in order", () => {
    const input = buildSceneChatInput({
      scene: "A star and a sun in orbit.",
      messages: [
        { role: "owner", text: "A star and a sun circling each other." },
        { role: "helper", text: "Warm or cool light?" },
        { role: "owner", text: "Warm. Make the sun bigger." },
      ],
    });

    expect(input).toContain("Current scene prompt:\nA star and a sun in orbit.");
    const order = ["Owner: A star and a sun circling", "Helper: Warm or cool light?", "Owner: Warm. Make the sun bigger."].map((line) =>
      input.indexOf(line),
    );
    expect(order.every((at) => at >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("says when there is no scene yet", () => {
    expect(buildSceneChatInput(REQUEST)).toContain("Current scene prompt:\n(none yet)");
  });
});

describe("parseSceneChatReply", () => {
  it("trims the reply and the scene", () => {
    expect(parseSceneChatReply(JSON.stringify({ reply: " Done. ", scene: " A sun. " }))).toEqual({ reply: "Done.", scene: "A sun." });
  });

  it.each([
    ["not JSON", "nope", "not valid JSON"],
    ["no scene", JSON.stringify({ reply: "Done.", scene: " " }), "no scene prompt"],
  ])("fails on %s", (_name, output, message) => {
    expect(() => parseSceneChatReply(output)).toThrow(message);
  });
});
