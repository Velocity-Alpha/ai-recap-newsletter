import OpenAI from "openai";

import { modelFields, type ModelOverrides, type ReasoningEffort } from "@/src/lib/reasoning-effort";
import {
  bulletList,
  buildSceneContext,
  SCENE_FRAME,
  SCENE_LAYERS,
  SCENE_PROMPT_MODEL,
  SCENE_REQUIREMENTS,
  SCENE_STYLE_WORDS,
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

/** The scene ideas' shorter list of forbidden interpretive words. */
export const SCENE_IDEAS_INTERPRETIVE_WORDS = ["represents", "symbolizes", "suggests", "metaphor", "theme", "message"] as const;
export const SCENE_IDEA_WORDS = { min: 120, max: 200 };
export const SCENE_IDEA_LABEL_WORDS = { min: 2, max: 6 };

/** The rule for the set of ideas. */
export const SCENE_IDEAS_DIFFERENT =
  "Make the three scenes clearly different: a different story, a different dominant subject, or a different visual idea.";

/** The instructions' "Global composition invariants for every scene", one rule each. Evals grade against these texts. */
export const SCENE_IDEAS_COMPOSITION = {
  centralVignette: `A central vignette within a ${SCENE_FRAME} frame. No objects, lines, or paint touch the edges of the frame.`,
  thumbnail: "Instant readability at thumbnail size through bold, simple shapes and clear silhouette separation.",
  hierarchy: "Strict hierarchy: one dominant subject, at most one supporting element.",
  noScreens: "No scenes that need reading screens, dashboards, paragraphs, multiple labels, code, or UI.",
  logo: "If a logo or readable brand mark is needed, include only one, printed on a physical object in the scene, small and natural.",
} as const;

/** The instructions' rules for each "scene", one rule each. */
export const SCENE_IDEAS_SCENE_RULES = {
  visibleOnly: `${SCENE_IDEA_WORDS.min} to ${SCENE_IDEA_WORDS.max} words of vivid description of what is visibly present.`,
  layers: `Specify ${SCENE_LAYERS.join(", ")}, camera angle and distance, and lighting.`,
  interpretive: `No interpretive or intent language (${SCENE_IDEAS_INTERPRETIVE_WORDS.join(", ")}).`,
  style: `Do not mention ${SCENE_STYLE_WORDS.join(", ")}, or any fixed style constraints.`,
} as const;

export const SCENE_IDEAS_LABEL_RULE = `${SCENE_IDEA_LABEL_WORDS.min} to ${SCENE_IDEA_LABEL_WORDS.max} plain words that name the scene.`;

const INSTRUCTIONS = `You are an editorial image creative director for a watercolor-style news illustration pipeline. You will be given a newsletter issue's subject line and its top stories. Suggest three different scenes for the issue's featured image. Each scene is a dynamic scene prompt that will later be combined with a separate fixed style prompt.

${SCENE_IDEAS_DIFFERENT}

Global composition invariants for every scene:

${bulletList(Object.values(SCENE_IDEAS_COMPOSITION))}

Rules for each "scene":

${bulletList(Object.values(SCENE_IDEAS_SCENE_RULES))}

Rules for each "label": ${SCENE_IDEAS_LABEL_RULE}

Return JSON only.`;

/** The user message: the shared scene requirements, worded for each scene, then the context. */
export function buildSceneIdeasInput(context: ScenePromptContext): string {
  return `${SCENE_REQUIREMENTS.replace("image_prompt", "each scene")}\n\n${buildSceneContext(context)}`;
}

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
          label: { type: "string", description: SCENE_IDEAS_LABEL_RULE },
          scene: { type: "string", description: `The scene prompt, ${SCENE_IDEA_WORDS.min} to ${SCENE_IDEA_WORDS.max} words. No style constraints.` },
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
    input: buildSceneIdeasInput(context),
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
