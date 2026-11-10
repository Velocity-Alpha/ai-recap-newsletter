import { ISSUE_PUBLISHED } from "@/src/features/newsletter/issue-status";
import type { IssueStateFacts } from "@/src/pipeline/distribution/issue-state";
import { prisma } from "@/src/server/prisma";

/**
 * Reads the facts `issueState` needs for one date, for the board and the 18:00 check. It imports only the
 * database client, so the checks function stays small.
 */

export interface StagedVersionRow {
  id: number;
  version: number;
  draftId: number;
  title: string;
  featuredImageUrl: string | null;
  stagedAt: Date | null;
  /** staged_versions.service, e.g. the key of the distribution service. */
  service: string;
  serviceUrl: string | null;
}

export interface DateIssueFacts extends IssueStateFacts {
  /** The issues for the date. In practice one. */
  issueIds: number[];
  newestDraft: (NonNullable<IssueStateFacts["newestDraft"]> & { editedAt: Date | null }) | null;
  newestStaged: StagedVersionRow | null;
  /** Every staged version for the date, newest first. */
  stagedVersions: StagedVersionRow[];
}

/** `date` is YYYY-MM-DD. */
export async function readDateIssueFacts(date: string): Promise<DateIssueFacts> {
  const issues = await prisma.issue.findMany({ where: { issueDate: new Date(`${date}T00:00:00.000Z`) }, select: { id: true, status: true } });
  const published = issues.some((issue) => issue.status === ISSUE_PUBLISHED);
  if (issues.length === 0) return { issueIds: [], published, newestDraft: null, newestStaged: null, stagedVersions: [] };

  const issueId = { in: issues.map((issue) => issue.id) };
  const [draft, staged] = await Promise.all([
    prisma.issueDraft.findFirst({
      where: { issueId },
      orderBy: [{ version: "desc" }, { id: "desc" }],
      select: { id: true, status: true, content: true, featuredImageUrl: true, editedAt: true },
    }),
    prisma.stagedVersion.findMany({
      where: { issueId, status: "staged" },
      orderBy: [{ version: "desc" }, { id: "desc" }],
      select: { id: true, version: true, draftId: true, title: true, featuredImageUrl: true, stagedAt: true, service: true, serviceUrl: true },
    }),
  ]);

  const title = (draft?.content as { title?: unknown } | null)?.title;
  const stagedVersions = staged.map((row) => ({ ...row, id: Number(row.id), draftId: Number(row.draftId) }));
  return {
    issueIds: issues.map((issue) => Number(issue.id)),
    published,
    newestDraft: draft && {
      id: Number(draft.id),
      status: draft.status,
      title: typeof title === "string" ? title : null,
      featuredImageUrl: draft.featuredImageUrl,
      editedAt: draft.editedAt,
    },
    newestStaged: stagedVersions[0] ?? null,
    stagedVersions,
  };
}
