import OpenAI from "openai";

import { modelFields, type ModelOverrides, type ReasoningEffort } from "@/src/lib/reasoning-effort";
import {
  buildSceneContext,
  SCENE_PROMPT_MODEL,
  SCENE_REQUIREMENTS,
  type ScenePromptClient,
  type ScenePromptContext,
} from "@/src/pipeline/draft/image/scene-prompt";

/**
 * "New image" (#116): three scene ideas for the owner to start from, in one GPT-6 Luna call. The context is the
 * same as the scene prompt's (the subject line and the top stories), and each idea follows the same composition
 * rules, so it can go straight into the image prompt box.
 */

export const SCENE_IDEAS_COUNT = 3;
/**
 * The model is SCENE_PROMPT_MODEL. Medium, from evals/results/scene-ideas.md (2 runs of 10 issues each). High
 * keeps more ideas to one supporting element (50 of 60 against 43 of 60), but the call runs in a web request with
 * a 45 s timeout: high's call p95 is 44.5 s and 1 of its 20 calls failed, while medium's call p95 is 20 s with none.
 */
export const SCENE_IDEAS_EFFORT: ReasoningEffort = "medium";
/** The board waits for this call, and a route must finish inside Netlify's 60 s. */
export const SCENE_IDEAS_TIMEOUT_MS = 45_000;

export interface SceneIdea {
  /** A few words for the button. */
  label: string;
  /** The scene prompt the idea puts in the box. */
  scene: string;
}

const INSTRUCTIONS = `You are an editorial image creative director for a watercolor-style news illustration pipeline. You will be given a newsletter issue's subject line and its top stories. Suggest three different scenes for the issue's featured image. Each scene is a dynamic scene prompt that will later be combined with a separate fixed style prompt.

Make the three scenes clearly different: a different story, a different dominant subject, or a different visual idea.

Global composition invariants for every scene:

* A central vignette within a 16:9 frame. No objects, lines, or paint touch the edges of the frame.
* Instant readability at thumbnail size through bold, simple shapes and clear silhouette separation.
* Strict hierarchy: one dominant subject, at most one supporting element.
* No scenes that need reading screens, dashboards, paragraphs, multiple labels, code, or UI.
* If a logo or readable brand mark is needed, include only one, printed on a physical object in the scene, small and natural.

Rules for each "scene":

* 120 to 200 words of vivid description of what is visibly present.
* Specify foreground, midground, background, camera angle and distance, and lighting.
* No interpretive or intent language (represents, symbolizes, suggests, metaphor, theme, message).
* Do not mention watercolor, palette, negative space, technique, or any fixed style constraints.

Rules for each "label": 2 to 6 plain words that name the scene.

Return JSON only.`;

const OUTPUT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["ideas"],
  properties: {
    ideas: {
      type: "array",
      description: "Exactly three scene ideas.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["label", "scene"],
        properties: {
          label: { type: "string", description: "2 to 6 plain words that name the scene." },
          scene: { type: "string", description: "The scene prompt, 120 to 200 words. No style constraints." },
        },
      },
    },
  },
};

export function parseSceneIdeas(outputText: string): SceneIdea[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("model output is not valid JSON.");
  }
  const raw = (parsed as { ideas?: unknown } | null)?.ideas;
  const ideas = (Array.isArray(raw) ? raw : [])
    .map((idea) => {
      const { label, scene } = (idea ?? {}) as { label?: unknown; scene?: unknown };
      return { label: typeof label === "string" ? label.trim() : "", scene: typeof scene === "string" ? scene.trim() : "" };
    })
    .filter((idea) => idea.label && idea.scene)
    .slice(0, SCENE_IDEAS_COUNT);
  if (ideas.length === 0) throw new Error("model output has no scene ideas.");
  return ideas;
}

/** `model` and `effort` are for evals: production uses SCENE_PROMPT_MODEL and SCENE_IDEAS_EFFORT. */
export interface SuggestSceneIdeasOptions extends ModelOverrides {
  client?: ScenePromptClient;
  apiKey?: string;
}

/** One call, no retries: the owner can ask again, or write a scene. */
export async function suggestSceneIdeas(
  context: ScenePromptContext,
  options: SuggestSceneIdeasOptions = {},
): Promise<SceneIdea[]> {
  if (!context.subjectLine.trim()) throw new Error("Scene ideas need the issue's subject line.");
  if (context.topStories.length === 0) throw new Error("Scene ideas need at least one of the issue's top stories.");

  const client =
    options.client ??
    (new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY }) as unknown as ScenePromptClient);
  const request = {
    ...modelFields(options, { model: SCENE_PROMPT_MODEL, effort: SCENE_IDEAS_EFFORT }),
    instructions: INSTRUCTIONS,
    input: `${SCENE_REQUIREMENTS.replace("image_prompt", "each scene")}\n\n${buildSceneContext(context)}`,
    store: false,
    text: { format: { type: "json_schema", name: "scene_ideas", strict: true, schema: OUTPUT_SCHEMA } },
  };
  try {
    const response = await client.responses.create(request as never, { timeout: SCENE_IDEAS_TIMEOUT_MS, maxRetries: 0 } as never);
    return parseSceneIdeas(response.output_text ?? "");
  } catch (error) {
    throw new Error(`Scene ideas failed: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
}
