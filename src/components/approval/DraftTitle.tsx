"use client";

import { useEffect, useReducer } from "react";

import { initialTitleState, saveTitle, titleIsDirty, titleReducer } from "@/src/features/newsletter/draft-view-state";

/**
 * The current draft's title, in a field the owner can change (#149). "Save" puts it into the same draft: no new
 * draft is made. The title is the email's subject line and the issue's title on the site.
 */

export type DraftTitleFieldProps = {
  value: string;
  /** The title the draft has now. */
  saved: string;
  busy: boolean;
  error: string | null;
  onChange: (value: string) => void;
  onSave: () => void;
  onReset: () => void;
};

const SAVE_BUTTON =
  "rounded-full bg-[var(--text-primary)] px-4 py-1.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-60";

export function DraftTitleField({ value, saved, busy, error, onChange, onSave, onReset }: DraftTitleFieldProps) {
  const changed = titleIsDirty({ value, saved });
  const empty = !value.trim();

  return (
    <form
      className="mt-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (changed && !empty && !busy) onSave();
      }}
    >
      <label htmlFor="draft-title" className="sr-only">
        Title
      </label>
      <input
        id="draft-title"
        type="text"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={busy}
        className="w-full rounded-xl border border-[var(--border-light)] bg-white px-3 py-2 font-serif text-[clamp(20px,2.6vw,28px)] leading-tight text-[var(--text-primary)] focus:border-[var(--accent-primary)] focus:outline-none disabled:opacity-60"
      />
      {changed || busy ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <button type="submit" className={SAVE_BUTTON} disabled={busy || empty}>
            {busy ? "Saving…" : "Save"}
          </button>
          <button
            type="button"
            className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-60"
            onClick={onReset}
            disabled={busy}
          >
            Cancel
          </button>
          <span className="text-xs text-[var(--text-secondary)]">Changes this draft. It makes no new draft.</span>
        </div>
      ) : null}
      {error ? (
        <p className="mt-2 whitespace-pre-wrap break-words rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3 text-sm text-[var(--accent-warm)]">
          {error}
        </p>
      ) : null}
    </form>
  );
}

type DraftTitleProps = {
  draftId: number;
  title: string;
  /** Runs after a save, and after a refusal, so the page reads the draft again. */
  onChanged?: () => void;
  /** Told whether the field holds a title that is not saved. Staging waits for it (see StageForSending). */
  onDirtyChange?: (dirty: boolean) => void;
};

/** The field with its state (draft-view-state.ts). */
export default function DraftTitle({ draftId, title, onChanged, onDirtyChange }: DraftTitleProps) {
  const [state, dispatch] = useReducer(titleReducer, title, initialTitleState);
  const dirty = titleIsDirty(state);

  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  // The field goes away when the draft can no longer be changed: nothing is unsaved then.
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);

  return (
    <DraftTitleField
      value={state.value}
      saved={state.saved}
      busy={state.busy}
      error={state.error}
      onChange={(value) => dispatch({ type: "typed", value })}
      onSave={() => void saveTitle(draftId, state.value, { dispatch, onChanged })}
      onReset={() => dispatch({ type: "cancelled" })}
    />
  );
}
