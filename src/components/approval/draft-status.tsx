import type { DraftStatus } from "@/src/pipeline/draft/draft-store";

const PILLS: Record<DraftStatus, { label: string; className: string }> = {
  running: { label: "Running", className: "bg-[rgba(232,242,248,0.9)] text-[var(--watercolor-ink)]" },
  ready: { label: "Ready", className: "bg-emerald-50 text-emerald-800" },
  failed: { label: "Failed", className: "bg-red-50 text-red-700" },
};

export function DraftStatusPill({ status }: { status: DraftStatus }) {
  const pill = PILLS[status] ?? PILLS.running;
  return <span className={`rounded-full px-3 py-1 text-xs font-medium ${pill.className}`}>{pill.label}</span>;
}

/** A draft time in New York time, like the issues page: "May 21, 10:00 AM EDT". */
export function formatDraftTime(iso: string | null): string {
  if (!iso) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(iso));
}

export function capitalize(text: string): string {
  return text ? text[0].toUpperCase() + text.slice(1) : text;
}
