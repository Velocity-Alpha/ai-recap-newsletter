"use client";

const REBUILD_WARNING =
  "Rebuild the board from the latest stories? Changes on this board will be lost.";

export function rebuildAfterWarning(
  onRebuild: () => void,
  confirm: (message: string) => boolean = (message) => window.confirm(message)
): void {
  if (confirm(REBUILD_WARNING)) onRebuild();
}

/** Shown when stories arrived after this board was cached and the owner has already changed it. */
export default function NewStoriesNotice({ onRebuild }: { onRebuild: () => void }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(107,155,184,0.3)] bg-[rgba(232,242,248,0.7)] px-4 py-3 sm:px-6">
      <p className="text-sm font-semibold text-[var(--watercolor-ink)]">
        New stories arrived since this board was built.
      </p>
      <button
        type="button"
        onClick={() => rebuildAfterWarning(onRebuild)}
        className="shrink-0 rounded-md border border-[rgba(107,155,184,0.5)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--watercolor-ink)] transition hover:bg-white"
      >
        Rebuild board
      </button>
    </div>
  );
}
