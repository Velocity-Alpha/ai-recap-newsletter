"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import type { ManualPublishPreview, ManualPublishStatus } from "@/src/pipeline/publish/manual-publish";

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "confirm"; preview: ManualPublishPreview }
  | { kind: "publishing"; preview: ManualPublishPreview }
  | { kind: "done"; message: string }
  | { kind: "error"; message: string };

const BLOCKED_MESSAGES: Record<Exclude<ManualPublishStatus, "ready">, string> = {
  already_published: "This issue is already published.",
  not_found: "This issue no longer exists.",
  no_email: "This issue has no email HTML to publish from.",
  wrong_issue: "The stored email belongs to a different issue.",
};

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

export default function MarkPublishedButton({ issueId }: { issueId: number }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ kind: "idle" });
  const endpoint = `/api/approval/issues/${issueId}/publish`;

  async function openConfirm() {
    setState({ kind: "loading" });
    const response = await fetch(endpoint, { cache: "no-store" });
    const body = await readJson(response);
    const preview = body.preview as ManualPublishPreview | undefined;
    if (!response.ok || !preview) {
      setState({ kind: "error", message: String(body.error ?? "Could not read the issue.") });
    } else if (preview.status !== "ready") {
      setState({ kind: "error", message: BLOCKED_MESSAGES[preview.status] });
    } else {
      setState({ kind: "confirm", preview });
    }
  }

  async function publish(preview: ManualPublishPreview) {
    setState({ kind: "publishing", preview });
    // proxy.ts accepts only JSON writes to the approval APIs.
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    const body = await readJson(response);
    if (body.outcome === "published") {
      setState({ kind: "done", message: "Published. It is now on airecap.news." });
      router.refresh();
      return;
    }
    const outcome = body.outcome as Exclude<ManualPublishStatus, "ready"> | undefined;
    setState({
      kind: "error",
      message: outcome && BLOCKED_MESSAGES[outcome] ? BLOCKED_MESSAGES[outcome] : String(body.error ?? "Could not publish."),
    });
  }

  if (state.kind === "confirm" || state.kind === "publishing") {
    const { preview } = state;
    const busy = state.kind === "publishing";
    return (
      <div className="mt-3 rounded-[14px] border border-[var(--border-light)] bg-[var(--bg-main)] p-4 text-sm">
        <p className="text-[var(--text-primary)]">
          Publish <strong>{preview.title || `issue ${preview.issueId}`}</strong>
          {preview.date ? ` (${preview.date})` : ""} with {preview.storyCount} stories on airecap.news now?
        </p>
        <p className="mt-1 text-[var(--text-secondary)]">
          This only updates the website and marks the stories as used. It sends no email.
        </p>
        {preview.problems.length > 0 && (
          <ul className="mt-3 list-disc space-y-1 pl-5 text-amber-800">
            {preview.problems.map((problem) => (
              <li key={problem}>{problem}</li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => publish(preview)}
            className="rounded-full bg-[var(--text-primary)] px-4 py-2 text-sm font-medium text-white transition hover:bg-[var(--watercolor-ink)] disabled:opacity-60"
          >
            {busy ? "Publishing…" : "Publish now"}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => setState({ kind: "idle" })}
            className="rounded-full border border-[var(--border-light)] px-4 py-2 text-sm text-[var(--text-secondary)] transition hover:text-[var(--text-primary)] disabled:opacity-60"
          >
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      {state.kind !== "done" && (
        <button
          type="button"
          disabled={state.kind === "loading"}
          onClick={openConfirm}
          className="rounded-full border border-[var(--border-light)] px-4 py-1.5 text-sm font-medium text-[var(--text-primary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] disabled:opacity-60"
        >
          {state.kind === "loading" ? "Checking…" : "Mark as published"}
        </button>
      )}
      {(state.kind === "done" || state.kind === "error") && (
        <p className={`text-xs ${state.kind === "error" ? "text-red-700" : "text-[var(--text-secondary)]"}`}>
          {state.message}
        </p>
      )}
    </div>
  );
}
