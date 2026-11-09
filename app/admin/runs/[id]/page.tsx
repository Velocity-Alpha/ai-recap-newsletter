import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyNote, LevelBadge, linkClass, PageHeader, RunStatusBadge, SectionTitle } from "@/src/components/admin/ui";
import { formatDuration, formatTime } from "@/src/features/admin/format";
import { getRunDetail, parseRunId } from "@/src/features/admin/runs";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Run | AI Recap operations" };

type Props = { params: Promise<{ id: string }> };

export default async function AdminRunPage({ params }: Props) {
  const { id } = await params;
  await requireAdminPage(`/admin/runs/${id}`);
  const runId = parseRunId(id);
  const detail = runId ? await getRunDetail(runId) : null;
  if (!detail) notFound();
  const { run, stats, events } = detail;

  const facts = [
    { label: "Status", value: <RunStatusBadge status={run.status} /> },
    { label: "Trigger", value: run.trigger },
    { label: "Started", value: formatTime(run.startedAt) },
    { label: "Finished", value: formatTime(run.finishedAt) },
    { label: "Duration", value: formatDuration(run.durationMs) },
  ];

  return (
    <>
      <Link href="/admin/runs" className={`text-sm ${linkClass}`}>
        ← All runs
      </Link>
      <div className="mt-6">
        <PageHeader eyebrow={`Run #${run.id}`} title={run.job} />
      </div>

      <dl className="grid grid-cols-2 gap-x-6 gap-y-4 rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-5 sm:grid-cols-5">
        {facts.map((fact) => (
          <div key={fact.label}>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{fact.label}</dt>
            <dd className="mt-1 text-sm tabular-nums text-[var(--text-primary)]">{fact.value}</dd>
          </div>
        ))}
      </dl>

      {run.error && (
        <p className="mt-4 rounded-[16px] border border-red-100 bg-red-50 px-5 py-4 text-sm text-red-800">{run.error}</p>
      )}

      {stats && (
        <section className="mt-10">
          <SectionTitle>Stats</SectionTitle>
          <pre className="overflow-x-auto rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] p-4 text-xs leading-5 text-[var(--text-primary)]">
            {stats}
          </pre>
        </section>
      )}

      <section className="mt-10">
        <SectionTitle aside={`${events.length} in order`}>Steps</SectionTitle>
        {events.length === 0 ? (
          <EmptyNote>This run logged no steps.</EmptyNote>
        ) : (
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={event.id} className="rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-4">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--text-secondary)]">
                  <span className="tabular-nums">{formatTime(event.at)}</span>
                  <LevelBadge level={event.level} />
                  <span className="font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{event.step}</span>
                </div>
                <p className="mt-2 text-sm leading-6 text-[var(--text-primary)]">{event.message}</p>
                {event.data && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                      Data
                    </summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-[var(--bg-warm)] p-3 leading-5">{event.data}</pre>
                  </details>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>
    </>
  );
}
