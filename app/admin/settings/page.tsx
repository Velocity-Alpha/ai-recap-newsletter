import type { Metadata } from "next";
import Link from "next/link";

import StageSwitchCard from "@/src/components/admin/StageSwitchCard";
import { EmptyNote, linkClass, PageHeader, SectionTitle, TableFrame, Td, Th } from "@/src/components/admin/ui";
import { listStageChanges } from "@/src/features/admin/change-stage-owner";
import { formatTime } from "@/src/features/admin/format";
import { readSettings } from "@/src/features/admin/settings";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings | AI Recap operations" };

const RECENT_CHANGES = 10;

export default async function AdminSettingsPage() {
  await requireAdminPage("/admin/settings");
  const [{ rows, stageSwitches }, changes] = await Promise.all([readSettings(), listStageChanges(RECENT_CHANGES)]);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Stage owners and settings">
        Each stage of the daily pipeline has one owner: n8n or this app (native). Switch a stage here. Times are New
        York time.
      </PageHeader>

      <section>
        <SectionTitle>Stage owners</SectionTitle>
        <div className="space-y-4">
          {stageSwitches.map((view) => (
            <StageSwitchCard
              key={view.key}
              view={view}
              updatedLabel={
                view.isSet
                  ? `Last changed ${formatTime(view.updatedAt ? new Date(view.updatedAt) : null)}`
                  : `Not set. The jobs use ${view.current}.`
              }
            />
          ))}
        </div>
      </section>

      <section className="mt-12">
        <SectionTitle aside={`last ${RECENT_CHANGES}`}>Recent changes</SectionTitle>
        {changes.length === 0 ? (
          <EmptyNote>No stage owner has been changed on this page yet.</EmptyNote>
        ) : (
          <TableFrame>
            <thead className="border-b border-[var(--border-light)]">
              <tr>
                <Th>When</Th>
                <Th>Setting</Th>
                <Th>Change</Th>
                <Th>By</Th>
                <Th>Log</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-light)]">
              {changes.map((change) => (
                <tr key={change.runId}>
                  <Td className="whitespace-nowrap tabular-nums text-[var(--text-secondary)]">{formatTime(change.at)}</Td>
                  <Td>
                    <code className="text-xs">{change.key}</code>
                  </Td>
                  <Td>
                    {change.from} → <strong>{change.to}</strong>
                  </Td>
                  <Td className="text-[var(--text-secondary)]">{change.by}</Td>
                  <Td>
                    <Link href={`/admin/runs/${change.runId}`} className={linkClass}>
                      #{change.runId}
                    </Link>
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>

      <section className="mt-12">
        <SectionTitle aside={`${rows.length} rows`}>All settings</SectionTitle>
        {rows.length === 0 ? (
          <EmptyNote>The pipeline_settings table is empty. Every job uses its default.</EmptyNote>
        ) : (
          <TableFrame>
            <thead className="border-b border-[var(--border-light)]">
              <tr>
                <Th>Key</Th>
                <Th>Value</Th>
                <Th>Updated</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-light)]">
              {rows.map((row) => (
                <tr key={row.key}>
                  <Td>
                    <code className="text-xs">{row.key}</code>
                  </Td>
                  <Td>
                    <code className="break-all text-xs">{row.value}</code>
                  </Td>
                  <Td className="whitespace-nowrap tabular-nums text-[var(--text-secondary)]">{formatTime(row.updatedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>
    </>
  );
}
