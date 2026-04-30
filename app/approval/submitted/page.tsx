import Link from "next/link";

export default function ApprovalSubmittedPage() {
  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-12 sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-10 text-center shadow-[0_30px_80px_rgba(61,79,95,0.12)] sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
            Submission Complete
          </p>
          <h1 className="mt-3 font-serif text-[clamp(30px,5vw,46px)] leading-tight text-[var(--text-primary)]">
            Successfully submitted.
          </h1>
          <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
            The approval payload has been sent. You can return to the board if you need to review another draft.
          </p>
          <div className="mt-8 flex justify-center">
            <Link
              href="/approval"
              className="inline-flex items-center justify-center rounded-full bg-[var(--text-primary)] px-5 py-2.5 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)]"
            >
              Back to approval board
            </Link>
          </div>
        </div>
      </div>
    </main>
  );
}
