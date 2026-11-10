import type { Metadata } from "next";

import { EmptyNote, PageHeader, SectionTitle, TableFrame, Td, Th } from "@/src/components/admin/ui";
import { formatTime } from "@/src/features/admin/format";
import { readSettings } from "@/src/features/admin/settings";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings | AI Recap operations" };

export default async function AdminSettingsPage() {
  await requireAdminPage("/admin/settings");
  const { rows } = await readSettings();

  return (
    <>
      <PageHeader eyebrow="Settings" title="Pipeline settings">
        The values the jobs read from the pipeline_settings table. A job uses its default when a row is missing.
        Times are New York time.
      </PageHeader>

      <section>
        <SectionTitle aside={`${rows.length} rows`}>Settings</SectionTitle>
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
