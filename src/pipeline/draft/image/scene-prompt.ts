import OpenAI from "openai";

import { withRetries } from "@/src/pipeline/draft/image/retry";

/**
 * The scene prompt: one GPT-6 Luna call that describes the day's picture. Ported from n8n `2.2.1 Sub: Create
 * Image Prompt` (docs/n8n-backend/20-drafting-and-images.md §3) and its caller's context template (§1.6.4).
 * The prompts are verbatim, including the known leftovers ("three AI news articles", four keys where the
 * strict schema allows two), because they produce the images the owner already approves.
 */

export const SCENE_PROMPT_MODEL = "gpt-6-luna";
export const SCENE_PROMPT_TIMEOUT_MS = 120_000;
export const SCENE_PROMPT_RETRIES = 2;

export interface ScenePromptContext {
  /** The issue's subject line (the written title). */
  subjectLine: string;
  /** The Top Stories section, in order. */
  topStories: Array<{ headline: string; detail: string }>;
}

export interface ScenePrompt {
  /** The scene part of the image prompt. The draft stores this. */
  scenePrompt: string;
  /** The model's short reason for the scene. Not stored by n8n; useful in logs. */
  rationale: string;
}

const SYSTEM_PROMPT = `You are an editorial image creative director and prompt writer for a watercolor-style news illustration pipeline. You will be given three AI news articles. Your job is to select the single best article to drive a readable illustration, then write a dynamic scene prompt that will later be combined with a separate fixed style prompt.

You must output only valid JSON with exactly these keys:

* "image_prompt"
* "caption_prompt"
* "excerpt"
* "editorial_rationale"

Global composition invariants:

* The scene must be designed as a central vignette within a 16:9 frame.
* Avoid any objects, lines, or paint that touch the edges of the frame.
* The subject and supporting elements must form a central cluster.
* Instant readability at thumbnail size through bold, simple shapes and clear silhouette separation.
* Strict hierarchy: one dominant subject, at most one supporting element.
* Avoid scenes that require reading screens, dashboards, paragraphs, multiple labels, code, or UI.
* Do not introduce extra characters, extra objects, or extra scenery beyond what the scene needs.
* If a logo or readable brand mark is needed, include only one, printed on a physical object in the scene, small and natural.

Rules for "image_prompt":

* 200 to 300 words of vivid description.
* Describe only what is visibly present: subjects, objects, setting, lighting, composition, scale, materials, and motion.
* Must specify foreground, midground, background.
* All background and midground elements must be described as tapering off or dissolving into the surrounding background space before reaching the frame boundaries
* Must specify camera angle and distance.
* Avoid interpretive or intent language. Do not use words such as: represents, symbolizes, suggests, implies, commentary, metaphor, theme, message, critique, scrutiny, oversight, regulation.
* Do not mention watercolor, palette, negative space, technique, or any fixed style constraints.

Rules for "caption_prompt":

* 6 to 10 words total.
* Two hook phrases separated by a comma.
* Must end exactly with “& more”.

Rules for "excerpt":

* Exactly two sentences separated by a single space.
* 15 to 20 total words.
* Summarize all three articles into one coherent summary.

Rules for "editorial_rationale":

* 2 to 3 sentences.
* Must name which article was chosen and briefly state why it was best for illustration.
* State what the scene is intended to show from that story in plain language.
* Do not describe visual elements that are not already in image_prompt.

Internal requirements (do not output):

* Consider at least three distinct scene concepts for the chosen article, then select the strongest.
* Before finalizing, check that the prompt names only one dominant subject and at most one supporting element.
* Ensure the scene remains readable without any text.

Output discipline:
Return JSON only. No preface. No markdown. No explanations.`;

const SCENE_REQUIREMENTS = `Dynamic scene requirements for image_prompt:

* Stage the scene as a vignetted central cluster within a 16:9 frame.
* Describe foreground, midground, background.
* State camera angle and distance.
* State lighting and mood as visible conditions.
* Include only a small number of grounding identifiers.
* At most one supporting element, clearly secondary.
* No interpretive language. Describe only what is visible.
* Logos/brand elements can be explicitly mentioned when needed instead of simulating them.
* Prefer scenes with simpler composition.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["image_prompt", "editorial_rationale"],
  properties: {
    image_prompt: {
      type: "string",
      description:
        "Dynamic scene-only image generation prompt (200–300 words). Must include '16:9' exactly once. Must describe a central cluster where foreground, midground, and background dissolve into white space before touching any frame edges. Specify camera angle and distance, lighting. No style constraints.",
    },
    editorial_rationale: {
      type: "string",
      description:
        "1–2 sentences explaining why this scene was chosen and what it shows from the chosen article. Can reference the chosen article explicitly. No more than 45 words.",
    },
  },
};

/** n8n's `context` for 2.2.1: the subject line, then the top stories as compact JSON. */
export function buildSceneContext(context: ScenePromptContext): string {
  const stories = JSON.stringify(context.topStories.map(({ headline, detail }) => ({ headline, detail })));
  return `You will receive a summary for a newsletter issue.

Task:

Using the summary provided, create a strong editorial featured image for an email newsletter based on:
  * A clear visual anchor you can stage as one dominant subject
  * Instant readability at a glance in 16:9 with minimal detail

Important: Focus on the main topic from the subject line of the email

Subject Line: ${context.subjectLine}

Top Stories:

${stories}`;
}

/** The user message: 2.2.1's scene requirements, then the context. */
export function buildScenePromptInput(context: ScenePromptContext): string {
  return `${SCENE_REQUIREMENTS}\n\n${buildSceneContext(context)}`;
}

export function parseScenePrompt(outputText: string): ScenePrompt {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("model output is not valid JSON.");
  }
  const output = (parsed ?? {}) as { image_prompt?: unknown; editorial_rationale?: unknown };
  if (typeof output.image_prompt !== "string") throw new Error("model output has no image_prompt.");
  const scenePrompt = output.image_prompt.trim();
  if (!scenePrompt) throw new Error("model output has an empty image_prompt.");
  return {
    scenePrompt,
    rationale: typeof output.editorial_rationale === "string" ? output.editorial_rationale.trim() : "",
  };
}

/** The part of the OpenAI client this needs, so tests can pass a fake. */
export interface ScenePromptClient {
  responses: { create(request: never, options?: never): Promise<{ output_text?: string }> };
}

export interface WriteScenePromptOptions {
  client?: ScenePromptClient;
  apiKey?: string;
  /** Wait between attempts. n8n waits 5 s. */
  retryDelayMs?: number;
}

/** Writes the scene prompt for an issue. Tries 3 times (2 retries), each with a 120 s timeout. */
export async function writeScenePrompt(
  context: ScenePromptContext,
  options: WriteScenePromptOptions = {},
): Promise<ScenePrompt> {
  if (!context.subjectLine.trim()) throw new Error("Scene prompt needs the issue's subject line.");
  if (context.topStories.length === 0) throw new Error("Scene prompt needs at least one of the issue's top stories.");

  const client =
    options.client ??
    (new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY }) as unknown as ScenePromptClient);
  const request = {
    model: SCENE_PROMPT_MODEL,
    instructions: SYSTEM_PROMPT,
    input: buildScenePromptInput(context),
    store: false,
    text: {
      format: { type: "json_schema", name: "image_prompt_output", strict: true, schema: OUTPUT_SCHEMA },
    },
  };
  // The timeout is per request so it also holds for an injected client. Our loop owns the retries.
  const requestOptions = { timeout: SCENE_PROMPT_TIMEOUT_MS, maxRetries: 0 };

  return withRetries(
    "Scene prompt",
    async () => {
      const response = await client.responses.create(request as never, requestOptions as never);
      return parseScenePrompt(response.output_text ?? "");
    },
    { retries: SCENE_PROMPT_RETRIES, delayMs: options.retryDelayMs ?? 5_000 },
  );
}
