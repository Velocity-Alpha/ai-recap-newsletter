import type { Metadata } from "next";
import Link from "next/link";

import { EmptyNote, linkClass, PageHeader, RunStatusBadge, SectionTitle, SeverityBadge } from "@/src/components/admin/ui";
import { formatDuration, formatTime } from "@/src/features/admin/format";
import { listIncidents } from "@/src/features/admin/incidents";
import { listRecentRuns } from "@/src/features/admin/runs";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Operations | AI Recap" };

const LATEST_RUNS = 5;
const OPEN_SHOWN = 3;

export default async function AdminOverviewPage() {
  await requireAdminPage("/admin");
  const [incidents, { runs }] = await Promise.all([
    listIncidents(),
    listRecentRuns({ limit: LATEST_RUNS }),
  ]);

  return (
    <>
      <PageHeader eyebrow="Operations" title="The pipeline at a glance">
        What is wrong right now, and the latest runs.
      </PageHeader>

      <section>
        <SectionTitle aside={<Link href="/admin/incidents" className={linkClass}>All incidents →</Link>}>
          {incidents.open.length === 1 ? "1 open incident" : `${incidents.open.length} open incidents`}
        </SectionTitle>
        {incidents.open.length === 0 ? (
          <EmptyNote>Nothing is open. Every check passes.</EmptyNote>
        ) : (
          <ul className="space-y-2">
            {incidents.open.slice(0, OPEN_SHOWN).map((incident) => (
              <li
                key={incident.id}
                className="flex flex-wrap items-center gap-3 rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-3"
              >
                <SeverityBadge severity={incident.severity} />
                <span className="text-sm text-[var(--text-primary)]">{incident.message}</span>
                <span className="ml-auto text-xs tabular-nums text-[var(--text-muted)]">
                  since {formatTime(incident.firstSeen)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SectionTitle aside={<Link href="/admin/runs" className={linkClass}>All runs →</Link>}>Latest runs</SectionTitle>
        {runs.length === 0 ? (
          <EmptyNote>No runs recorded yet.</EmptyNote>
        ) : (
          <ul className="divide-y divide-[var(--border-light)] rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)]">
            {runs.map((run) => (
              <li key={run.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-5 py-3 text-sm">
                <Link href={`/admin/runs/${run.id}`} className={linkClass}>
                  #{run.id}
                </Link>
                <span className="font-medium text-[var(--text-primary)]">{run.job}</span>
                <RunStatusBadge status={run.status} />
                <span className="ml-auto tabular-nums text-[var(--text-secondary)]">
                  {formatTime(run.startedAt)} · {formatDuration(run.durationMs)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
