"use client";

import { PageHeader } from "@/src/components/admin/ui";

type Props = { error: Error & { digest?: string }; reset: () => void };

/** Error boundary for /admin. Shows a plain retry message only: never the error's message, stack, or digest. */
export default function AdminError({ reset }: Props) {
  return (
    <>
      <PageHeader eyebrow="Operations" title="Something went wrong">
        This page could not load. Try again in a moment.
      </PageHeader>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-full bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)]"
      >
        Try again
      </button>
    </>
  );
}
