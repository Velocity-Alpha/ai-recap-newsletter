import { formatDraftTime } from "@/src/components/approval/draft-status";
import { draftViewHref } from "@/src/features/newsletter/draft-links";
import { issueStateText, stagedChangeNote } from "@/src/pipeline/distribution/issue-state";
import type { DateDraftsView } from "@/src/pipeline/draft/draft-board";

const LINK =
  "shrink-0 rounded-md border border-[rgba(107,155,184,0.5)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--watercolor-ink)] transition hover:bg-white";

/**
 * The state of the board's date (#149): "No outline", "Drafting", "Draft failed", "Draft ready", "Staged, v2",
 * or "Published", with a link to the date's draft page so the owner can always get back to it.
 */
export default function DateState({ date, view }: { date: string; view: DateDraftsView }) {
  const { state, currentDraft } = view;
  const latest = state.kind === "staged" ? view.stagedVersions.find((version) => version.version === state.version) : undefined;
  const changeNote = stagedChangeNote(state);

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(107,155,184,0.3)] bg-[rgba(232,242,248,0.7)] px-4 py-3 sm:px-6"
      data-date-state={state.kind}
    >
      <p className="text-sm text-[var(--watercolor-ink)]">
        <span className="font-semibold">{issueStateText(state)}</span>
        {latest?.stagedAt ? <span> · {formatDraftTime(latest.stagedAt)}</span> : null}
        {changeNote ? <span className="ml-2 text-[var(--accent-warm)]">{changeNote}</span> : null}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {latest?.serviceUrl ? (
          <a href={latest.serviceUrl} target="_blank" rel="noopener noreferrer" className={LINK}>
            Open in {latest.serviceName}
          </a>
        ) : null}
        {currentDraft ? (
          <a href={draftViewHref(date)} className={LINK}>
            Open the draft
          </a>
        ) : null}
      </div>
    </div>
  );
}
