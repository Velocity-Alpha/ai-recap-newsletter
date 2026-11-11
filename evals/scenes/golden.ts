import { join } from "node:path";

import { goldenFor, loadGolden, missingGolden, type Golden } from "@/evals/lib/golden";
import type { SceneIssue } from "@/evals/scenes/issues";
import type { ScenePromptContext } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The golden values of both scene evals, one per issue: which top story is the lead, and what a scene of it should
 * show. Made by Claude Opus from our own text (evals/scenes/golden-todo.md), so the file is committed.
 */

export const SCENE_GOLDEN_PATH = join("evals", "scenes", "golden.json");
/** Where evals/scenes/golden-inputs.ts writes each issue's golden input, for the agents that make the values. */
export const SCENE_GOLDEN_INPUTS_DIR = join("evals", "data", "scenes", "golden-inputs");

export interface SceneGolden {
  /** 1-based number of the top story the subject line is about. */
  lead_story: number;
  /** 1 to 4 concrete identifiers of the lead story's news a scene should show: a company, product, or object. */
  identifiers: string[];
  /** Readings of the lead story a scene must not show, for example the wrong company or a story it is not. */
  forbidden_misreads?: string[];
}

/** The golden input of an issue: what the golden agent reads and what the entry's inputHash covers. */
export function sceneGoldenInput(issue: SceneIssue): ScenePromptContext {
  return issue.context;
}

/** The id of an issue in the evals and in golden.json. */
export function sceneItemId(issue: SceneIssue): string {
  return issue.date;
}

/** Refuses a value that breaks the shape of SceneGolden for this issue. */
export function checkSceneGolden(value: SceneGolden, context: ScenePromptContext): void {
  if (!Number.isInteger(value.lead_story) || value.lead_story < 1 || value.lead_story > context.topStories.length) {
    throw new Error(`lead_story ${value.lead_story} is not a top story (1 to ${context.topStories.length}).`);
  }
  const identifiers = value.identifiers ?? [];
  if (identifiers.length < 1 || identifiers.length > 4 || identifiers.some((identifier) => !identifier.trim())) {
    throw new Error("identifiers needs 1 to 4 non-empty identifiers.");
  }
}

/** The golden value of an issue; throws when it is missing, stale, or malformed. */
export function sceneGoldenFor(golden: Golden<SceneGolden>, issue: SceneIssue): SceneGolden {
  const value = goldenFor(golden, sceneItemId(issue), sceneGoldenInput(issue));
  try {
    checkSceneGolden(value, issue.context);
  } catch (error) {
    throw new Error(`Golden value of ${sceneItemId(issue)}: ${error instanceof Error ? error.message : String(error)}`);
  }
  return value;
}

/** Loads golden.json and refuses to start a run while any issue lacks a current golden value. */
export function readSceneGolden(issues: SceneIssue[], path = SCENE_GOLDEN_PATH): Golden<SceneGolden> {
  const golden = loadGolden<SceneGolden>(path);
  const missing = missingGolden(
    golden,
    issues.map((issue) => ({ id: sceneItemId(issue), input: sceneGoldenInput(issue) }))
  );
  if (missing.length > 0) {
    throw new Error(`${path} has no current golden value for ${missing.length} issues (${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}). See evals/scenes/golden-todo.md.`);
  }
  for (const issue of issues) sceneGoldenFor(golden, issue);
  return golden;
}
