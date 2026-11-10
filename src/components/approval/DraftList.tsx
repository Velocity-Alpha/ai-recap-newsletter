import { formatDraftTime } from "@/src/components/approval/draft-status";
import type { StagedVersionEntry } from "@/src/pipeline/draft/draft-board";

const MARK = "rounded-full px-3 py-1 text-xs font-semibold";

/** The date's staged versions, newest first (#149). The owner never sees a draft row's number here. */
export default function DraftList({ stagedVersions }: { stagedVersions: StagedVersionEntry[] }) {
  if (stagedVersions.length === 0) {
    return <p className="text-sm text-[var(--text-secondary)]">Nothing is staged for this date yet.</p>;
  }

  return (
    <ul className="space-y-2">
      {stagedVersions.map((version) => (
        <li
          key={version.id}
          className={`rounded-[16px] border px-4 py-3 ${
            version.latest ? "border-[var(--accent-primary)] bg-[rgba(232,242,248,0.5)]" : "border-[var(--border-light)] bg-[var(--bg-card)]"
          }`}
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                v{version.version}
                {version.stagedAt ? ` · ${formatDraftTime(version.stagedAt)}` : ""}
              </p>
              <p className="mt-1 truncate font-serif text-base text-[var(--text-primary)]">{version.title}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-1.5">
              {version.sent ? <span className={`${MARK} bg-emerald-50 text-emerald-800`}>Sent</span> : null}
              {version.latest ? <span className={`${MARK} bg-[rgba(232,242,248,0.9)] text-[var(--watercolor-ink)]`}>Latest</span> : null}
            </div>
          </div>
          {version.serviceUrl ? (
            <a
              href={version.serviceUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-block text-xs font-medium text-[var(--accent-primary)] hover:underline"
            >
              Open in {version.serviceName}
            </a>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
