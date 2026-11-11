import type { SceneIssue } from "@/evals/scenes/issues";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { imageContextFor } from "@/src/pipeline/draft/produce-draft";

/**
 * Turns a published issue into a scene eval item: the context the draft builds (`imageContextFor`), that is the
 * subject line and the Top Stories with their story detail. Our own text only. `produce-draft` imports Prisma, so
 * a test that imports this file mocks `@/src/server/prisma`.
 */

/** A row of newsletter.issues, as evals/scenes/build-issues.ts reads it. */
export interface IssueRow {
  id: string;
  date: string;
  content: Pick<WrittenIssueContent, "title" | "headlines">;
}

export function sceneIssueFrom(row: IssueRow): SceneIssue {
  return { issueId: Number(row.id), date: row.date, context: imageContextFor(row.content as WrittenIssueContent) };
}
