import { readOnlyQuery } from "@/evals/lib/dev-db";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import type { ScenePromptContext } from "@/src/pipeline/draft/image/scene-prompt";
import { imageContextFor } from "@/src/pipeline/draft/produce-draft";

/**
 * The test set of both scene evals: 10 published issues (2026-10-26 to 2026-11-06) from the Neon `dev` branch,
 * read-only. Each becomes the context the draft builds (`imageContextFor`): the subject line and the Top Stories
 * with their story detail. Our own text only. `produce-draft` imports Prisma, so an importer mocks
 * `@/src/server/prisma`.
 */

export const SCENE_ISSUE_DATES = { from: "2026-10-26", to: "2026-11-06" };

export interface SceneIssue {
  issueId: number;
  date: string;
  context: ScenePromptContext;
}

interface IssueRow {
  id: string;
  date: string;
  content: Pick<WrittenIssueContent, "title" | "headlines">;
}

export function sceneIssueFrom(row: IssueRow): SceneIssue {
  return { issueId: Number(row.id), date: row.date, context: imageContextFor(row.content as WrittenIssueContent) };
}

export async function loadSceneIssues(): Promise<SceneIssue[]> {
  const rows = await readOnlyQuery<IssueRow>(
    `SELECT id, to_char(issue_date, 'YYYY-MM-DD') AS date, content_json AS content
       FROM newsletter.issues
      WHERE status = 'published' AND issue_date BETWEEN $1 AND $2
        AND jsonb_typeof(content_json->'headlines') = 'array' AND jsonb_array_length(content_json->'headlines') > 0
      ORDER BY issue_date`,
    [SCENE_ISSUE_DATES.from, SCENE_ISSUE_DATES.to]
  );
  if (rows === null) throw new Error("The scene evals read past issues from the Neon dev branch: set DATABASE_URL (evals/README.md).");
  if (rows.length === 0) throw new Error(`No published issues from ${SCENE_ISSUE_DATES.from} to ${SCENE_ISSUE_DATES.to} on the Neon dev branch.`);
  return rows.map(sceneIssueFrom);
}
