import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { ScenePromptContext } from "@/src/pipeline/draft/image/scene-prompt";

/**
 * The test set of both scene evals: published issues, frozen in evals/scenes/issues.json so that a reset of the
 * Neon dev branch does not change it. evals/scenes/build-issues.ts writes the file (`npm run eval:build`).
 */

export const SCENE_ISSUES_PATH = join("evals", "scenes", "issues.json");

/** One published issue as both scene evals see it: the context the draft builds for the featured image. */
export interface SceneIssue {
  issueId: number;
  date: string;
  context: ScenePromptContext;
}

export interface SceneIssuesFile {
  note: string;
  /** The first and last issue date the build read. */
  from: string;
  to: string;
  issues: SceneIssue[];
}

export function readSceneIssues(path = SCENE_ISSUES_PATH): SceneIssuesFile {
  const file = JSON.parse(readFileSync(path, "utf8")) as SceneIssuesFile;
  if (!Array.isArray(file.issues) || file.issues.length === 0) throw new Error(`${path} holds no issues.`);
  return file;
}
