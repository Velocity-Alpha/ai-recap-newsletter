"use client";

import { useState } from "react";

import { requestTitleChange } from "@/src/features/newsletter/draft-edit-client";

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
  const changed = value.replace(/\s+/g, " ").trim() !== saved;
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

/** The field with its state. `onChanged` runs after a save, so the page reads the draft again. */
export default function DraftTitle({ draftId, title, onChanged }: { draftId: number; title: string; onChanged?: () => void }) {
  const [value, setValue] = useState(title);
  const [saved, setSaved] = useState(title);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setError(null);
    try {
      const stored = await requestTitleChange(draftId, value);
      setSaved(stored);
      setValue(stored);
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Could not change the title.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <DraftTitleField
      value={value}
      saved={saved}
      busy={busy}
      error={error}
      onChange={setValue}
      onSave={() => void save()}
      onReset={() => {
        setValue(saved);
        setError(null);
      }}
    />
  );
}
