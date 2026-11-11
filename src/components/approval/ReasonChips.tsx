import type { GivenReason } from "@/components/approval/board-feedback";

/**
 * The optional reasons on the board (#150): **reason codes** as one-tap chips, and a short text. Nothing here is
 * required; no tap and no text means no reason.
 */

const CHIP =
  "rounded-full border px-2 py-0.5 text-[11px] transition focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]";

/** One tap selects a chip; a second tap on it clears it. */
export function ReasonChips({ codes, selected, onSelect }: { codes: string[]; selected: string; onSelect: (code: string) => void }) {
  if (codes.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {codes.map((code) => {
        const isSelected = code === selected;
        return (
          <button
            key={code}
            type="button"
            aria-pressed={isSelected}
            onClick={() => onSelect(isSelected ? "" : code)}
            className={`${CHIP} ${
              isSelected
                ? "border-[var(--accent-primary)] bg-[rgba(107,155,184,0.12)] text-[var(--accent-primary)]"
                : "border-[var(--border-light)] bg-white text-[var(--text-muted)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            }`}
          >
            {code}
          </button>
        );
      })}
    </div>
  );
}

/** One small muted line: a question, its chips, and a short text field. */
export function ReasonLine({
  question,
  placeholder,
  codes,
  reason,
  onChange,
}: {
  question: string;
  placeholder: string;
  codes: string[];
  reason: GivenReason | undefined;
  onChange: (reason: GivenReason) => void;
}) {
  const current = reason ?? { code: "", text: "" };
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--text-muted)]">
      <span>{question}</span>
      <ReasonChips codes={codes} selected={current.code} onSelect={(code) => onChange({ ...current, code })} />
      <input
        type="text"
        placeholder={placeholder}
        value={current.text}
        onChange={(e) => onChange({ ...current, text: e.target.value })}
        className="min-w-0 max-w-[16rem] flex-1 rounded-lg border border-[var(--border-light)] bg-white px-2 py-0.5 text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
      />
    </div>
  );
}
