"use client";

import { useReducer } from "react";
import { ExternalLink, Send } from "lucide-react";

import { formatDraftTime } from "@/src/components/approval/draft-status";
import { confirmVersionFor, INITIAL_STAGE_STATE, shownStaged, stageDraft, stageReducer } from "@/src/features/newsletter/draft-view-state";
import type { DraftBoardView, StagedSummary } from "@/src/pipeline/draft/draft-board";

/**
 * "Stage for sending" on the draft view (#149, ADR 0005): one click copies the current draft into the
 * distribution service as the issue's next staged version. The owner sends it from there. A draft that has not
 * changed since the newest staged version needs a second yes.
 */

export type StagePanelProps = {
  /** The issue's newest staged version, if any. */
  staged: StagedSummary | null;
  /** Set when this page staged it outside production: nothing reached the service. */
  recorded: boolean;
  /** Why the draft cannot be staged. Null when it can. */
  disabledReason: string | null;
  busy: boolean;
  /** Set when the draft matches this staged version: the panel asks before it stages again. */
  confirmVersion: number | null;
  error: string | null;
  onStage: () => void;
  onConfirm: () => void;
  onCancel: () => void;
};

const DARK_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full bg-[var(--text-primary)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-60";
const LIGHT_BUTTON =
  "inline-flex items-center gap-1.5 rounded-full border border-[var(--border-light)] px-3 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-60";
const WARM_NOTE = "rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3 text-sm text-[var(--accent-warm)]";

/**
 * Why a draft cannot be staged, in plain words. Null when it can. `titleDirty`: the title field holds a title
 * that is not saved, and staging would leave it out without a word.
 */
export function stageDisabledReason(
  draft: Pick<DraftBoardView, "status" | "issuePublished" | "hasNewerDraft">,
  options: { titleDirty?: boolean } = {},
): string | null {
  if (draft.issuePublished) return "This issue is published. Nothing more can be staged.";
  if (draft.hasNewerDraft) return "A newer draft exists. Only the newest draft can be staged.";
  if (draft.status === "running") return "The draft is not ready yet.";
  if (draft.status === "failed") return "This draft failed. Retry it first.";
  if (options.titleDirty) return "Save or cancel the title change first.";
  return null;
}

export function StagePanel(props: StagePanelProps) {
  const { staged, recorded, disabledReason, busy, confirmVersion, error } = props;
  const blocked = disabledReason !== null;

  return (
    <div className="space-y-3" data-stage-panel>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" className={DARK_BUTTON} onClick={props.onStage} disabled={busy || blocked || confirmVersion !== null}>
          <Send className="h-3.5 w-3.5" aria-hidden />
          {busy ? "Staging…" : "Stage for sending"}
        </button>
        <span className="text-xs text-[var(--text-secondary)]">
          {disabledReason ?? "Copies this draft to the distribution service as the next staged version. You send it from there."}
        </span>
      </div>

      {confirmVersion !== null ? (
        <div className={WARM_NOTE} role="alert">
          <p>
            v{confirmVersion} is already staged, and the draft has not changed since. Stage it again?
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" className={DARK_BUTTON} onClick={props.onConfirm} disabled={busy || blocked}>
              {busy ? "Staging…" : "Stage it again"}
            </button>
            <button type="button" className={LIGHT_BUTTON} onClick={props.onCancel} disabled={busy}>
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {staged ? (
        <div className="flex flex-wrap items-center gap-3" data-staged-version={staged.version}>
          <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800">Staged, v{staged.version}</span>
          {staged.stagedAt ? <span className="text-xs text-[var(--text-muted)]">{formatDraftTime(staged.stagedAt)}</span> : null}
          {staged.serviceUrl ? (
            <a href={staged.serviceUrl} target="_blank" rel="noreferrer" className={LIGHT_BUTTON}>
              Open in {staged.serviceName}
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
            </a>
          ) : (
            <span className="text-xs text-[var(--text-secondary)]">
              {recorded ? `Not sent outside production: nothing reached ${staged.serviceName}.` : `Find it in ${staged.serviceName} by its name.`}
            </span>
          )}
        </div>
      ) : null}

      {error ? (
        <p className={`whitespace-pre-wrap break-words ${WARM_NOTE}`} role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

type StageForSendingProps = {
  draft: DraftBoardView;
  /** The title field holds a title that is not saved. */
  titleDirty?: boolean;
  /** Runs after a staging, and after a refusal, so the page reads the draft again. */
  onStaged?: () => void;
};

/** The panel with its state (draft-view-state.ts). */
export default function StageForSending({ draft, titleDirty = false, onStaged }: StageForSendingProps) {
  const [state, dispatch] = useReducer(stageReducer, INITIAL_STAGE_STATE);
  const shown = shownStaged(draft.staged, state.justStaged);
  const stage = (confirmRepeat: boolean) => void stageDraft(draft, confirmRepeat, { dispatch, onChanged: onStaged });

  return (
    <StagePanel
      staged={shown.staged}
      recorded={shown.recorded}
      disabledReason={stageDisabledReason(draft, { titleDirty })}
      busy={state.busy}
      // Gone once the draft has a new title or image: the question is about the draft as it was.
      confirmVersion={confirmVersionFor(state.confirm, draft.editedAt)}
      error={state.error}
      onStage={() => stage(false)}
      onConfirm={() => stage(true)}
      onCancel={() => dispatch({ type: "cancelled" })}
    />
  );
}
