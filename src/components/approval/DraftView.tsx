import { Check, ExternalLink, Loader2, TriangleAlert, X } from "lucide-react";

import { capitalize, DraftStatusPill, formatDraftTime } from "@/src/components/approval/draft-status";
import { draftHtmlSrc } from "@/src/features/newsletter/draft-links";
import type { DraftBoardView, DraftStepState } from "@/src/pipeline/draft/draft-board";

/**
 * One draft on the board (#79): its steps while it runs, the email preview when it is ready, and the failed step
 * with "Retry" when it fails. Kept small and plain: #117 replaces it with a full review flow.
 */

type DraftViewProps = {
  draft: DraftBoardView;
  retryBusy: boolean;
  retryError: string | null;
  onRetry: () => void;
};

const CARD = "rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-5 sm:px-6";
const KICKER = "text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]";
const WARM_NOTE = "rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3 text-sm text-[var(--accent-warm)]";

function StepIcon({ state }: { state: DraftStepState }) {
  if (state === "done") return <Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden />;
  if (state === "current") return <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--accent-primary)]" aria-hidden />;
  if (state === "failed") return <X className="h-3.5 w-3.5 text-red-600" aria-hidden />;
  return <span className="h-1.5 w-1.5 rounded-full bg-[var(--border)]" aria-hidden />;
}

const STEP_TEXT: Record<DraftStepState, string> = {
  done: "text-[var(--text-secondary)]",
  current: "font-medium text-[var(--text-primary)]",
  failed: "font-medium text-red-700",
  waiting: "text-[var(--text-muted)]",
};

function Steps({ draft }: { draft: DraftBoardView }) {
  return (
    <ol className="mt-4 grid gap-1.5 sm:grid-cols-2">
      {draft.steps.map((step) => (
        <li key={step.key} data-step={step.key} data-state={step.state} className="flex items-center gap-2 text-sm">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center">
            <StepIcon state={step.state} />
          </span>
          <span className={STEP_TEXT[step.state]}>{capitalize(step.label)}</span>
        </li>
      ))}
    </ol>
  );
}

function RetryButton({ busy, onRetry }: { busy: boolean; onRetry: () => void }) {
  return (
    <button
      type="button"
      className="rounded-full bg-[var(--text-primary)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-60"
      onClick={onRetry}
      disabled={busy}
    >
      {busy ? "Retrying…" : "Retry"}
    </button>
  );
}

function GhlLink({ draft }: { draft: DraftBoardView }) {
  if (draft.ghlPreviewUrl) {
    return (
      <a
        href={draft.ghlPreviewUrl}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
      >
        Open in GHL
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    );
  }
  if (draft.ghlTemplateId) {
    return <span className="text-sm text-[var(--text-secondary)]">GHL template {draft.ghlTemplateId}</span>;
  }
  return null;
}

function UnreadStories({ draft }: { draft: DraftBoardView }) {
  if (draft.unreadStories.length === 0) return null;
  return (
    <div className={WARM_NOTE}>
      <p className="font-semibold">Source not read</p>
      <p className="mt-1">
        The writer could not read the article for these stories, so their write-ups use only the story summary. Check
        them before you send.
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-5">
        {draft.unreadStories.map((story) => (
          <li key={story.id}>
            {story.url ? (
              <a href={story.url} target="_blank" rel="noreferrer" className="underline underline-offset-2">
                {story.headline}
              </a>
            ) : (
              story.headline
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DraftView({ draft, retryBusy, retryError, onRetry }: DraftViewProps) {
  const running = draft.status === "running";
  const failed = draft.status === "failed";
  const showPreview = draft.hasHtml && !running;

  return (
    <section className="space-y-4">
      <div className={CARD}>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className={KICKER}>
              Draft v{draft.version}
              {draft.issueDate ? ` · ${draft.issueDate}` : ""}
            </p>
            <h2 className="mt-2 font-serif text-[clamp(22px,3vw,30px)] leading-tight text-[var(--text-primary)]">
              {draft.subject ?? (running ? "Writing the issue…" : "No subject yet")}
            </h2>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Committed {formatDraftTime(draft.createdAt)}
              {draft.finishedAt ? ` · finished ${formatDraftTime(draft.finishedAt)}` : ""}
            </p>
          </div>
          <DraftStatusPill status={draft.status} />
        </div>

        {running ? (
          <div className="mt-4">
            <p className="text-sm font-medium text-[var(--text-primary)]">
              {draft.stepLabel ? `Now: ${draft.stepLabel}` : "Waiting for the draft job to start…"}
            </p>
            <p className="mt-1 text-xs text-[var(--text-secondary)]">
              This page checks every few seconds. A draft takes a minute or two.
            </p>
          </div>
        ) : null}

        {failed ? (
          <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3">
            <p className="flex items-center gap-2 text-sm font-semibold text-red-700">
              <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
              Failed at {draft.failedStepLabel ?? "an unknown step"}.
            </p>
            {draft.error ? <p className="mt-1 whitespace-pre-wrap break-words text-sm text-red-700">{draft.error}</p> : null}
          </div>
        ) : null}

        {running && draft.retryable ? (
          <p className={`mt-4 ${WARM_NOTE}`}>
            {draft.startedAt
              ? "This draft has not moved for 20 minutes. Its job has probably stopped."
              : "This draft is still waiting. Its job has not started after 5 minutes, so it probably never got the request."}
          </p>
        ) : null}

        {draft.status !== "ready" ? <Steps draft={draft} /> : null}

        {draft.retryable ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <RetryButton busy={retryBusy} onRetry={onRetry} />
            <span className="text-xs text-[var(--text-secondary)]">Runs this draft again from the start, as v{draft.version}.</span>
          </div>
        ) : null}
        {retryError ? <p className={`mt-3 ${WARM_NOTE}`}>{retryError}</p> : null}

        {draft.status === "ready" ? (
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <GhlLink draft={draft} />
            {/* #116: the "New image" button goes here. It opens the image panel for this ready draft. */}
          </div>
        ) : null}
      </div>

      <UnreadStories draft={draft} />

      {showPreview ? (
        <div className="overflow-hidden rounded-[20px] border border-[var(--border-light)] bg-white">
          <p className={`border-b border-[var(--border-light)] px-5 py-3 ${KICKER}`}>Email preview</p>
          <iframe
            src={draftHtmlSrc(draft.id)}
            sandbox="allow-popups allow-popups-to-escape-sandbox"
            title={`Email preview, draft v${draft.version}`}
            className="h-[80vh] w-full bg-white"
          />
        </div>
      ) : null}
    </section>
  );
}
