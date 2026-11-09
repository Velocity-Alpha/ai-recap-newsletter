import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, linkClass, PageHeader, RunStatusBadge, TableFrame, Td, Th } from "@/src/components/admin/ui";
import { formatDuration, formatTime } from "@/src/features/admin/format";
import { listRecentRuns, parseRunId, RUNS_PAGE_SIZE } from "@/src/features/admin/runs";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Runs | AI Recap operations" };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AdminRunsPage({ searchParams }: Props) {
  await requireAdminPage("/admin/runs");
  const { before } = await searchParams;
  const beforeId = parseRunId(typeof before === "string" ? before : null);
  const { runs, olderBefore } = await listRecentRuns({ before: beforeId });

  return (
    <>
      <PageHeader eyebrow="Runs" title={beforeId ? `Runs before #${beforeId}` : "Recent runs"}>
        Every job run, newest first, {RUNS_PAGE_SIZE} to a page. Open a run to read its steps. Times are New York
        time.
      </PageHeader>

      {runs.length === 0 ? (
        <EmptyNote>No runs recorded yet.</EmptyNote>
      ) : (
        <TableFrame>
          <thead className="border-b border-[var(--border-light)]">
            <tr>
              <Th>Run</Th>
              <Th>Job</Th>
              <Th>Status</Th>
              <Th>Started</Th>
              <Th className="text-right">Duration</Th>
              <Th>Stats</Th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-light)]">
            {runs.map((run) => (
              <tr key={run.id}>
                <Td>
                  <Link href={`/admin/runs/${run.id}`} className={linkClass}>
                    #{run.id}
                  </Link>
                </Td>
                <Td>
                  <span className="font-medium">{run.job}</span>
                  <span className="block text-xs text-[var(--text-muted)]">{run.trigger}</span>
                </Td>
                <Td>
                  <RunStatusBadge status={run.status} />
                </Td>
                <Td className="whitespace-nowrap tabular-nums text-[var(--text-secondary)]">{formatTime(run.startedAt)}</Td>
                <Td className="whitespace-nowrap text-right tabular-nums">{formatDuration(run.durationMs)}</Td>
                <Td className="min-w-[16rem] text-xs leading-5 text-[var(--text-secondary)]">
                  {run.statsSummary || "—"}
                  {run.error && <span className="mt-1 block text-red-800">{run.error}</span>}
                </Td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}

      <div className="mt-6 flex justify-between text-sm">
        {beforeId ? (
          <Link href="/admin/runs" className={linkClass}>
            ← Newest runs
          </Link>
        ) : (
          <span />
        )}
        {olderBefore && (
          <Link href={`/admin/runs?before=${olderBefore}`} className={linkClass}>
            Older runs →
          </Link>
        )}
      </div>
    </>
  );
}
