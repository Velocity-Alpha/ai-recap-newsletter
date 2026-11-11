import type { Metadata } from "next";

import IgnoreSiteButton from "@/src/components/admin/IgnoreSiteButton";
import { EmptyNote, PageHeader, SectionTitle, TableFrame, Td, Th } from "@/src/components/admin/ui";
import { formatTime } from "@/src/features/admin/format";
import { readPaywallSites } from "@/src/features/admin/paywall-sites";
import { readSettings } from "@/src/features/admin/settings";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Settings | AI Recap operations" };

export default async function AdminSettingsPage() {
  await requireAdminPage("/admin/settings");
  const [{ rows }, sites] = await Promise.all([readSettings(), readPaywallSites()]);

  return (
    <>
      <PageHeader eyebrow="Settings" title="Pipeline settings">
        The values the jobs read from the pipeline_settings table, and the sites the paywall check learned. A job
        uses its default when a settings row is missing. Times are New York time.
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

      <section className="mt-12">
        <SectionTitle aside={`${sites.length} sites`}>Learned paywalled sites</SectionTitle>
        <p className="mb-4 max-w-2xl text-sm leading-6 text-[var(--text-secondary)]">
          Sites where the article reader found a suggested link paywalled. From 2 stories on, the paywall check
          treats the site as paywalled. Ignore a site that is not paywalled: it is then never learned again.
        </p>
        {sites.length === 0 ? (
          <EmptyNote>No site was found paywalled yet.</EmptyNote>
        ) : (
          <TableFrame>
            <thead className="border-b border-[var(--border-light)]">
              <tr>
                <Th>Site</Th>
                <Th>Stories</Th>
                <Th>Updated</Th>
                <Th>State</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border-light)]">
              {sites.map((site) => (
                <tr key={site.site}>
                  <Td>
                    <code className="text-xs">{site.site}</code>
                  </Td>
                  <Td className="tabular-nums">{site.stories}</Td>
                  <Td className="whitespace-nowrap tabular-nums text-[var(--text-secondary)]">{formatTime(site.updatedAt)}</Td>
                  <Td>
                    {site.ignored ? (
                      <span className="text-[var(--text-secondary)]">ignored</span>
                    ) : (
                      <span className="inline-flex items-center gap-3">
                        <span className="text-[var(--text-secondary)]">{site.learned ? "learned" : "not learned yet"}</span>
                        <IgnoreSiteButton site={site.site} />
                      </span>
                    )}
                  </Td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </section>
    </>
  );
}
