import type { Prisma } from "@/src/generated/prisma";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { dateKey, issueFields } from "@/src/pipeline/draft/draft-store";

/**
 * Reads of staged versions (GLOSSARY.md, ADR 0005) for publish detection. Staging itself is in stage-draft.ts.
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
 * the version that was sent and not the newest draft.
 *
 * - The email names the version (`data-version-id`): only that version counts. If it is not a staged version
 *   of this issue, the answer is null and the caller publishes what the email itself says. The draft's other
 *   versions are not tried: after a title or image change they differ from the email that was sent.
 * - An email staged before #149 names only its draft (`data-draft-id`): that draft's newest staged version.
 *
 * `fields` is null when the version is found but its copy is not complete; the event still keeps its id.
 */
export async function sentVersionIssueFields(
  client: Client,
  issueId: number,
  sent: { versionId: number | null; draftId: number | null },
): Promise<{ stagedVersionId: number; fields: ReturnType<typeof issueFields> | null } | null> {
  const where = { issueId: BigInt(issueId), status: "staged" };
  let version;
  if (sent.versionId !== null) {
    version = await client.stagedVersion.findFirst({ where: { ...where, id: BigInt(sent.versionId) }, select: SENT_SELECT });
  } else if (sent.draftId !== null) {
    version = await client.stagedVersion.findFirst({ where: { ...where, draftId: BigInt(sent.draftId) }, orderBy: { version: "desc" }, select: SENT_SELECT });
  }
  if (!version) return null;
  const stagedVersionId = Number(version.id);

  const { html, featuredImageUrl, scenePrompt } = version;
  if (!html || !featuredImageUrl || !scenePrompt) return { stagedVersionId, fields: null };
  const issue = await client.issue.findUnique({ where: { id: BigInt(issueId) }, select: { issueDate: true } });
  const issueDate = dateKey(issue?.issueDate ?? null);
  if (!issueDate) return { stagedVersionId, fields: null };
  return {
    stagedVersionId,
    fields: issueFields({ content: version.content as unknown as WrittenIssueContent, html, featuredImageUrl, scenePrompt }, { issueId, issueDate }),
  };
}
