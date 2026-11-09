import type { Metadata } from "next";

import { EmptyNote, linkClass, PageHeader, SectionTitle, SeverityBadge, SmartLink } from "@/src/components/admin/ui";
import { formatTime } from "@/src/features/admin/format";
import { listIncidents, RECENT_RESOLVED, type IncidentRow } from "@/src/features/admin/incidents";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Incidents | AI Recap operations" };

function IncidentCard({ incident }: { incident: IncidentRow }) {
  const times = [
    { label: "First seen", value: incident.firstSeen },
    { label: "Last seen", value: incident.lastSeen },
    { label: "Last alert", value: incident.lastAlertedAt },
    ...(incident.resolvedAt ? [{ label: "Resolved", value: incident.resolvedAt }] : []),
  ];

  return (
    <li className="rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <SeverityBadge severity={incident.severity} />
            <code className="break-all text-xs text-[var(--text-secondary)]">{incident.key}</code>
          </div>
          <p className="mt-2 font-serif text-lg leading-snug text-[var(--text-primary)]">{incident.message}</p>
          {incident.evidence && (
            <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{incident.evidence}</p>
          )}
        </div>
        {incident.link && (
          <SmartLink href={incident.link} className={`shrink-0 text-sm ${linkClass}`}>
            Look into it →
          </SmartLink>
        )}
      </div>
      <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-xs sm:grid-cols-4">
        {times.map((time) => (
          <div key={time.label}>
            <dt className="font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">{time.label}</dt>
            <dd className="mt-0.5 tabular-nums text-[var(--text-primary)]">{formatTime(time.value)}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export default async function AdminIncidentsPage() {
  await requireAdminPage("/admin/incidents");
  const { open, resolved } = await listIncidents();

  return (
    <>
      <PageHeader eyebrow="Incidents" title="Open and recent incidents">
        An incident is one ongoing problem found by a check or a job. It stays open until the check passes again.
        Times are New York time.
      </PageHeader>

      <section>
        <SectionTitle aside={`${open.length} open`}>Open</SectionTitle>
        {open.length === 0 ? (
          <EmptyNote>No open incidents.</EmptyNote>
        ) : (
          <ul className="space-y-3">
            {open.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </ul>
        )}
      </section>

      <section className="mt-12">
        <SectionTitle aside={`last ${RECENT_RESOLVED}`}>Recently resolved</SectionTitle>
        {resolved.length === 0 ? (
          <EmptyNote>Nothing resolved yet.</EmptyNote>
        ) : (
          <ul className="space-y-3">
            {resolved.map((incident) => (
              <IncidentCard key={incident.id} incident={incident} />
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
