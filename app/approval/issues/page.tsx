import type { Metadata } from "next";
import Link from "next/link";

import MarkPublishedButton from "@/src/components/approval/MarkPublishedButton";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import { requireApprovalSession } from "@/src/server/approval-page-guard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Issues | AI Recap",
};

const RECENT_ISSUES = 15;

function formatIssueDate(value: Date | null): string {
  if (!value) return "No date";
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(value);
}

function formatPublishedAt(value: Date): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(value);
}

export default async function ApprovalIssuesPage() {
  await requireApprovalSession("/approval/issues");
  const issues = await createPrismaPublishStore().listRecentIssues(RECENT_ISSUES);

  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-12 sm:px-6">
      <div className="mx-auto max-w-3xl">
        <Link href="/approval" className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          ← Approval board
        </Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
          Issues
        </p>
        <h1 className="mt-2 font-serif text-[clamp(28px,4vw,40px)] leading-tight text-[var(--text-primary)]">
          Recent issues
        </h1>
        <p className="mt-3 text-base leading-7 text-[var(--text-secondary)]">
          An issue appears on airecap.news once it is published. If a sent issue did not appear, mark it as
          published here.
        </p>

        <ul className="mt-8 space-y-3">
          {issues.map((issue) => {
            const hasEmail = Boolean(issue.html?.includes("data-issue-id"));
            return (
              <li
                key={issue.id}
                className="rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-4"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                      #{issue.id} · {formatIssueDate(issue.issueDate)}
                    </p>
                    <p className="mt-1 truncate font-serif text-lg text-[var(--text-primary)]">{issue.title}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    {issue.publishedAt ? (
                      <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-800">
                        Published {formatPublishedAt(issue.publishedAt)}
                      </span>
                    ) : hasEmail ? (
                      <span className="rounded-full bg-amber-50 px-3 py-1 text-xs font-medium text-amber-800">
                        Draft
                      </span>
                    ) : (
                      <span className="text-xs text-[var(--text-secondary)]">No email yet</span>
                    )}
                  </div>
                </div>
                {!issue.publishedAt && hasEmail && (
                  <div className="mt-3">
                    <MarkPublishedButton issueId={issue.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
