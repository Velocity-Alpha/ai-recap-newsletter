import type { Prisma } from "@/src/generated/prisma";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { dateKey, issueFields } from "@/src/pipeline/draft/draft-store";

/**
 * Reads of staged versions (GLOSSARY.md, ADR 0004) for publish detection. Staging itself is in stage-draft.ts.
 */

type Client = Prisma.TransactionClient;

const SENT_SELECT = {
  id: true,
  issueId: true,
  content: true,
  html: true,
  featuredImageUrl: true,
  scenePrompt: true,
} as const;

/**
 * The staged version a sent email was made from, with the issue columns its copies give, so the archive shows
 * the version that was sent and not the newest draft. The email names the version (`data-version-id`). An
 * email staged before #149 names only its draft (`data-draft-id`): that draft's newest staged version is used.
 * Null when there is no such staged version of this issue, or its copy is not complete.
 */
export async function sentVersionIssueFields(
  client: Client,
  issueId: number,
  sent: { versionId: number | null; draftId: number | null },
): Promise<{ stagedVersionId: number; fields: ReturnType<typeof issueFields> } | null> {
  const where = { issueId: BigInt(issueId), status: "staged" };
  const byVersion =
    sent.versionId === null ? null : await client.stagedVersion.findFirst({ where: { ...where, id: BigInt(sent.versionId) }, select: SENT_SELECT });
  const version =
    byVersion ??
    (sent.draftId === null
      ? null
      : await client.stagedVersion.findFirst({ where: { ...where, draftId: BigInt(sent.draftId) }, orderBy: { version: "desc" }, select: SENT_SELECT }));
  if (!version || !version.html || !version.featuredImageUrl || !version.scenePrompt) return null;

  const issue = await client.issue.findUnique({ where: { id: BigInt(issueId) }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) return null;
  const { html, featuredImageUrl, scenePrompt } = version;
  return {
    stagedVersionId: Number(version.id),
    fields: issueFields({ content: version.content as unknown as WrittenIssueContent, html, featuredImageUrl, scenePrompt }, { issueId, issueDate }),
  };
}
