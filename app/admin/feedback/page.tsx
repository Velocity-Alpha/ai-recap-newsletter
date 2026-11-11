import type { Metadata } from "next";

import { EmptyNote, PageHeader, SectionTitle, TableFrame, Td, Th } from "@/src/components/admin/ui";
import { FEEDBACK_DAYS, readFeedback } from "@/src/features/admin/feedback";
import { requireAdminPage } from "@/src/server/admin-auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Board feedback | AI Recap operations" };

const NUMBER = "tabular-nums text-right";

export default async function AdminFeedbackPage() {
  await requireAdminPage("/admin/feedback");
  const { days, sections, reasons } = await readFeedback();

  return (
    <>
      <PageHeader eyebrow="Feedback" title="How the proposed board was changed">
        For each issue date, the newest commit compared with the proposed board: what the board showed before
        the first change. A story is kept in place when it was proposed and approved in the same section.
      </PageHeader>

      {days.length === 0 ? (
        <EmptyNote>No commits with a proposed board yet.</EmptyNote>
      ) : (
        <>
          <section>
            <SectionTitle aside={`last ${FEEDBACK_DAYS} issue dates`}>By day</SectionTitle>
            <TableFrame>
              <thead className="border-b border-[var(--border-light)]">
                <tr>
                  <Th>Date</Th>
                  <Th className="text-right">Proposed</Th>
                  <Th className="text-right">Kept in place</Th>
                  <Th className="text-right">Excluded</Th>
                  <Th className="text-right">Added</Th>
                  <Th className="text-right">Moved</Th>
                  <Th>Lead changed</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-light)]">
                {days.map((day) => (
                  <tr key={day.date}>
                    <Td className="whitespace-nowrap tabular-nums">{day.date}</Td>
                    <Td className={NUMBER}>{day.proposed}</Td>
                    <Td className={NUMBER}>{day.keptInPlace}</Td>
                    <Td className={NUMBER}>{day.excluded}</Td>
                    <Td className={NUMBER}>{day.added}</Td>
                    <Td className={NUMBER}>{day.moved}</Td>
                    <Td>{day.leadChanged ? "yes" : "no"}</Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </section>

          <section className="mt-12">
            <SectionTitle>By section</SectionTitle>
            <TableFrame>
              <thead className="border-b border-[var(--border-light)]">
                <tr>
                  <Th>Section</Th>
                  <Th className="text-right">Proposed</Th>
                  <Th className="text-right">Kept in place</Th>
                  <Th className="text-right">Share kept</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-light)]">
                {sections.map((section) => (
                  <tr key={section.key}>
                    <Td>{section.label}</Td>
                    <Td className={NUMBER}>{section.proposed}</Td>
                    <Td className={NUMBER}>{section.keptInPlace}</Td>
                    <Td className={NUMBER}>{section.share}%</Td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          </section>

          <section className="mt-12">
            <SectionTitle>Reason codes</SectionTitle>
            {reasons.length === 0 ? (
              <EmptyNote>No reason code was tapped yet.</EmptyNote>
            ) : (
              <TableFrame>
                <thead className="border-b border-[var(--border-light)]">
                  <tr>
                    <Th>Action</Th>
                    <Th>Reason code</Th>
                    <Th className="text-right">Count</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-light)]">
                  {reasons.map((reason) => (
                    <tr key={`${reason.action}:${reason.code}`}>
                      <Td>{reason.action}</Td>
                      <Td>{reason.code}</Td>
                      <Td className={NUMBER}>{reason.count}</Td>
                    </tr>
                  ))}
                </tbody>
              </TableFrame>
            )}
          </section>
        </>
      )}
    </>
  );
}
