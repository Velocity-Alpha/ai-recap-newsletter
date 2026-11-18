import OpenAI from "openai";

import { modelFields, type ModelOverrides, type ReasoningEffort } from "@/src/lib/reasoning-effort";
import {
  SCENE_IDEA_WORDS,
  SCENE_IDEAS_COMPOSITION,
  SCENE_IDEAS_SCENE_RULES,
} from "@/src/pipeline/draft/image/scene-ideas";
import { bulletList, SCENE_PROMPT_MODEL, type ScenePromptClient } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The scene chat in "New image": the owner describes a picture, or a change, in plain words. One GPT-6 Luna call
 * writes the scene prompt to the same rules as the scene ideas, and gives a one-line reply. The board sends the
 * whole conversation each time, so the server keeps no chat state.
 */

/** Medium, like the scene ideas: the board waits for this call. */
export const SCENE_CHAT_EFFORT: ReasoningEffort = "medium";
/** A route must finish inside Netlify's 60 s. */
export const SCENE_CHAT_TIMEOUT_MS = 45_000;

export interface SceneChatMessage {
  role: "owner" | "helper";
  text: string;
}

export interface SceneChatRequest {
  /** The scene prompt the owner's newest message changes. Empty for a new picture. */
  scene: string;
  /** The conversation so far, oldest first. The last message is the owner's. */
  messages: SceneChatMessage[];
}

export interface SceneChatReply {
  /** One or two short sentences for the owner. */
  reply: string;
  /** The full scene prompt, ready for "Generate". */
  scene: string;
}

export const SCENE_CHAT_REPLY_RULE =
  "One or two short, plain sentences: say what the scene now shows. Ask at most one question, only if a choice would clearly improve the picture.";

const INSTRUCTIONS = `You are an editorial image creative director for a watercolor-style news illustration pipeline. The newsletter owner describes the picture they want, or a change to it, in plain words. Write the dynamic scene prompt for it. A separate fixed style prompt is added later.

If the owner's newest message changes the current scene prompt, keep everything they did not ask to change. If it describes a different picture, write a new scene. Follow what the owner asks for, within these rules.

Global composition invariants:

${bulletList(Object.values(SCENE_IDEAS_COMPOSITION))}

Rules for "scene":

${bulletList(Object.values(SCENE_IDEAS_SCENE_RULES))}

Rules for "reply": ${SCENE_CHAT_REPLY_RULE}

Return JSON only.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["reply", "scene"],
  properties: {
    reply: { type: "string", description: SCENE_CHAT_REPLY_RULE },
    scene: { type: "string", description: `The full scene prompt, ${SCENE_IDEA_WORDS.min} to ${SCENE_IDEA_WORDS.max} words. No style constraints.` },
  },
};

export function buildSceneChatInput(request: SceneChatRequest): string {
  const conversation = request.messages.map((message) => `${message.role === "owner" ? "Owner" : "Helper"}: ${message.text}`).join("\n");
  return `Current scene prompt:\n${request.scene.trim() || "(none yet)"}\n\nConversation:\n${conversation}`;
}

export function parseSceneChatReply(outputText: string): SceneChatReply {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("model output is not valid JSON.");
  }
  const { reply, scene } = (parsed ?? {}) as { reply?: unknown; scene?: unknown };
  const result = { reply: typeof reply === "string" ? reply.trim() : "", scene: typeof scene === "string" ? scene.trim() : "" };
  if (!result.scene) throw new Error("model output has no scene prompt.");
  return result;
}

/** `model` and `effort` are for evals: production uses SCENE_PROMPT_MODEL and SCENE_CHAT_EFFORT. */
export interface WriteSceneFromChatOptions extends ModelOverrides {
  client?: ScenePromptClient;
  apiKey?: string;
}

/** One call, no retries: the owner can send again. */
export async function writeSceneFromChat(request: SceneChatRequest, options: WriteSceneFromChatOptions = {}): Promise<SceneChatReply> {
  const client =
    options.client ??
    (new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY }) as unknown as ScenePromptClient);
  const body = {
    ...modelFields(options, { model: SCENE_PROMPT_MODEL, effort: SCENE_CHAT_EFFORT }),
    instructions: INSTRUCTIONS,
    input: buildSceneChatInput(request),
    store: false,
    text: { format: { type: "json_schema", name: "scene_chat", strict: true, schema: OUTPUT_SCHEMA } },
  };
  try {
    const response = await client.responses.create(body as never, { timeout: SCENE_CHAT_TIMEOUT_MS, maxRetries: 0 } as never);
    return parseSceneChatReply(response.output_text ?? "");
  } catch (error) {
    throw new Error(`Scene chat failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
