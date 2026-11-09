import Link from "next/link";

import { DraftStatusPill, formatDraftTime } from "@/src/components/approval/draft-status";
import { draftViewHref } from "@/src/features/newsletter/draft-links";
import type { DraftListEntry } from "@/src/pipeline/draft/draft-board";

/** Every draft for the date, newest first. Each row opens that draft in the draft view. */
export default function DraftList({ date, drafts, selectedId }: { date: string; drafts: DraftListEntry[]; selectedId: number | null }) {
  if (drafts.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">No drafts for this date yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {drafts.map((draft) => {
        const selected = draft.id === selectedId;
        return (
          <li
            key={draft.id}
            className={`rounded-[16px] border px-4 py-3 ${
              selected ? "border-[var(--accent-primary)] bg-[rgba(232,242,248,0.5)]" : "border-[var(--border-light)] bg-[var(--bg-card)]"
            }`}
          >
            <div className="flex items-start justify-between gap-3">
              <Link
                href={draftViewHref(date, draft.id)}
                aria-current={selected ? "true" : undefined}
                className="min-w-0 flex-1 hover:text-[var(--accent-primary)]"
              >
                <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                  v{draft.version} · {formatDraftTime(draft.createdAt)}
                  {draft.sourceVersion !== null ? ` · New image of v${draft.sourceVersion}` : ""}
                </p>
                <p className="mt-1 truncate font-serif text-base text-[var(--text-primary)]">
                  {draft.subject ?? (draft.status === "failed" ? `Failed at ${draft.failedStepLabel ?? "an unknown step"}` : "No subject yet")}
                </p>
              </Link>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <DraftStatusPill status={draft.status} />
                {draft.sent ? (
                  <span className="rounded-full bg-[rgba(232,242,248,0.9)] px-3 py-1 text-xs font-semibold text-[var(--watercolor-ink)]">Sent</span>
                ) : null}
                {draft.current ? <span className="text-xs font-medium text-[var(--accent-primary)]">Current</span> : null}
              </div>
            </div>
            {draft.status === "failed" && draft.subject ? (
              <p className="mt-1 text-xs text-red-700">Failed at {draft.failedStepLabel ?? "an unknown step"}</p>
            ) : null}
            {draft.ghlPreviewUrl ? (
              <a
                href={draft.ghlPreviewUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-2 inline-block text-xs text-[var(--text-secondary)] underline underline-offset-2 hover:text-[var(--accent-primary)]"
              >
                Open in GHL
              </a>
            ) : draft.ghlTemplateId ? (
              <p className="mt-2 text-xs text-[var(--text-muted)]">GHL template {draft.ghlTemplateId}</p>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
