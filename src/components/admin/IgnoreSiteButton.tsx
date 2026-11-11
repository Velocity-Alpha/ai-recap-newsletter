"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

/** Marks a learned paywalled site as ignored (#59), then loads the page again. */
export default function IgnoreSiteButton({ site }: { site: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "saving" | "failed">("idle");

  const ignore = async () => {
    setState("saving");
    try {
      const response = await fetch("/api/admin/paywall-sites/ignore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ site }),
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setState("idle");
      router.refresh();
    } catch {
      setState("failed");
    }
  };

  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={ignore}
        disabled={state === "saving"}
        aria-label={`Ignore ${site}`}
        className="rounded-full border border-[var(--border-light)] px-3 py-1 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-50"
      >
        {state === "saving" ? "Ignoring…" : "Ignore"}
      </button>
      {state === "failed" ? <span className="text-xs text-red-700">Did not save. Try again.</span> : null}
    </span>
  );
}
