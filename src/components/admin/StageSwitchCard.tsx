"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import type { StageSwitchView } from "@/src/features/admin/stage-switches";

type Option = StageSwitchView["options"][number];

type State =
  | { kind: "idle" }
  | { kind: "confirm"; option: Option }
  | { kind: "saving"; option: Option }
  | { kind: "done"; to: string; runId: string }
  | { kind: "error"; message: string };

export default function StageSwitchCard({ view, updatedLabel }: { view: StageSwitchView; updatedLabel: string }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const currentLabel = view.options.find((option) => option.isCurrent)?.label ?? view.current;

  async function change(option: Option) {
    setState({ kind: "saving", option });
    const response = await fetch("/api/admin/stage-switches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: view.key, value: option.value }),
    }).catch(() => null);
    const body = (await response?.json().catch(() => null)) as
      | { change?: { to: string; runId: string }; error?: string }
      | null;

    if (response?.ok && body?.change) {
      setState({ kind: "done", to: body.change.to, runId: body.change.runId });
      router.refresh();
      return;
    }
    if (response?.status === 401) {
      setState({ kind: "error", message: "Your sign-in has ended. Reload the page to sign in again. Nothing was saved." });
      return;
    }
    setState({ kind: "error", message: body?.error ?? "Could not change the setting. Nothing was saved." });
  }

  const pending = state.kind === "confirm" || state.kind === "saving" ? state.option : null;

  return (
    <article className="rounded-[16px] border border-[var(--border-light)] bg-[var(--bg-card)] px-5 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 max-w-xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--accent-primary)]">
            {view.stage} · <code className="normal-case tracking-normal">{view.key}</code>
          </p>
          <h3 className="mt-1 font-serif text-xl text-[var(--text-primary)]">
            Owner: <span className="italic">{currentLabel}</span>
          </h3>
          <p className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{view.description}</p>
          <p className="mt-1 text-xs text-[var(--text-muted)]">{updatedLabel}</p>
        </div>

        {!pending && (
          <div className="flex flex-col items-end gap-2">
            {view.options
              .filter((option) => !option.isCurrent)
              .map((option) => (
                <div key={option.value} className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    disabled={Boolean(option.disabledReason)}
                    onClick={() => setState({ kind: "confirm", option })}
                    className="rounded-full border border-[var(--border)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-[var(--border)] disabled:hover:text-[var(--text-primary)]"
                  >
                    Switch to {option.label}
                  </button>
                  {option.disabledReason && (
                    <p className="text-xs text-[var(--text-secondary)]">{option.disabledReason}</p>
                  )}
                </div>
              ))}
          </div>
        )}
      </div>

      {pending && (
        <div className="mt-4 rounded-[14px] border border-[var(--border-light)] bg-[var(--bg-main)] p-4 text-sm">
          <p className="text-[var(--text-primary)]">
            Switch <code>{view.key}</code> from <strong>{view.current}</strong> to <strong>{pending.value}</strong>?
          </p>
          <p className="mt-2 leading-6 text-[var(--text-primary)]">{pending.consequence}</p>
          <p className="mt-2 text-[var(--text-secondary)]">
            It takes effect the next time the stage runs. The change is logged with the time, the old and new value, and who made it.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={state.kind === "saving"}
              onClick={() => change(pending)}
              className="rounded-full bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:opacity-60"
            >
              {state.kind === "saving" ? "Switching…" : `Yes, switch to ${pending.label}`}
            </button>
            <button
              type="button"
              disabled={state.kind === "saving"}
              onClick={() => setState({ kind: "idle" })}
              className="rounded-full border border-[var(--border-light)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-60"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {state.kind === "done" && (
        <p className="mt-3 text-sm text-emerald-800">
          Switched to {state.to}. Logged as{" "}
          <Link href={`/admin/runs/${state.runId}`} className="underline underline-offset-4">
            run #{state.runId}
          </Link>
          .
        </p>
      )}
      {state.kind === "error" && <p className="mt-3 text-sm text-red-700">{state.message}</p>}
    </article>
  );
}
