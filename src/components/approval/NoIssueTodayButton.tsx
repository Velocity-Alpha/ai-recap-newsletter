"use client";

import { useEffect, useState } from "react";

/**
 * "No issue today" (#52): marks the board's date as a skipped date, so the check job leaves it alone.
 * It can be undone until that day is over in New York.
 */

type Status = { skipped: boolean; canChange: boolean };

const newYorkToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(new Date());

export default function NoIssueTodayButton({ dateKey }: { dateKey: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endpoint = "/api/approval/skipped-dates";

  useEffect(() => {
    let active = true;
    fetch(`${endpoint}?date=${dateKey}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { skipped: unknown; canChange: boolean } | null) => {
        if (active && body) setStatus({ skipped: Boolean(body.skipped), canChange: body.canChange });
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [dateKey]);

  async function change(skip: boolean) {
    setBusy(true);
    setError(null);
    const response = skip
      ? await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ date: dateKey }) })
      : await fetch(`${endpoint}?date=${dateKey}`, { method: "DELETE" });
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    if (response.ok) setStatus((current) => ({ canChange: current?.canChange ?? true, skipped: skip }));
    else setError(body.error ?? "Could not save.");
    setBusy(false);
  }

  if (!status || (!status.skipped && !status.canChange)) return null;
  const label = dateKey === newYorkToday() ? "No issue today" : "No issue this day";

  if (status.skipped) {
    return (
      <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(184,133,110,0.5)] bg-[rgba(255,244,236,0.85)] px-3 py-1 text-[11px] font-medium text-[var(--accent-warm)]">
        <span>{label}: checks off</span>
        {status.canChange && (
          <button type="button" disabled={busy} onClick={() => change(false)} className="underline underline-offset-2 hover:text-[var(--text-primary)] disabled:opacity-50">
            Undo
          </button>
        )}
        {error && <span className="text-red-700">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-1.5">
      {error && <span className="text-[11px] text-red-700">{error}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={() => change(true)}
        title="Mark this date as a skipped date. The checks leave it alone. You can undo it until the day is over."
        className="rounded-md border border-[var(--border-light)] bg-white/70 px-3 py-1.5 text-xs font-medium text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-50"
      >
        {label}
      </button>
    </div>
  );
}
