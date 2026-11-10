"use client";

import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import DraftList from "@/components/approval/DraftList";
import DraftView from "@/components/approval/DraftView";
import { currentDraftHref, jsonPost } from "@/src/features/newsletter/draft-links";
import { nextDraftPoll, type DraftPollOutcome } from "@/src/features/newsletter/draft-polling";
import { issueStateText, stagedChangeNote } from "@/src/pipeline/distribution/issue-state";
import type { DateDraftsView, DraftBoardView } from "@/src/pipeline/draft/draft-board";

// The draft page (#79, #149): the date's current draft (live progress, preview, or failure) and its staged
// versions. proxy.ts keeps it behind the approval login, like the rest of /approval.

function parseDate(value: string | null): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date().toISOString().slice(0, 10);
}

function parseDraftId(value: string | null): number | null {
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function formatDate(date: string): string {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${date}T00:00:00Z`),
  );
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

function Message({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-8 text-sm text-[var(--text-secondary)]">
      {children}
    </div>
  );
}

function DraftsForDate({ date, requestedId }: { date: string; requestedId: number | null }) {
  const [list, setList] = useState<DateDraftsView | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [draft, setDraft] = useState<DraftBoardView | null>(null);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [retryBusy, setRetryBusy] = useState(false);
  const [retryError, setRetryError] = useState<string | null>(null);
  // Bumped after "Retry", a title or image change, or a staging, to read the draft again (and poll while it runs).
  const [reload, setReload] = useState(0);

  const selectedId = requestedId ?? list?.currentDraft?.id ?? null;
  const draftStatus = draft?.status;
  const stagedVersion = draft?.staged?.version;
  const draftEditedAt = draft?.editedAt;
  const currentHref = currentDraftHref(date, list?.currentDraft?.id, selectedId);
  const changeNote = list ? stagedChangeNote(list.state) : null;

  // The date's state and staged versions again whenever the shown draft changes status, gets a new staged
  // version, or gets a new title or image.
  useEffect(() => {
    let active = true;
    fetch(`/api/approval/drafts?${new URLSearchParams({ date })}`, { cache: "no-store" })
      .then(async (response) => {
        const body = await readJson(response);
        if (!active) return;
        if (!response.ok) throw new Error(String(body.error ?? `Drafts returned ${response.status}.`));
        setList(body as unknown as DateDraftsView);
        setListError(null);
      })
      .catch((error: unknown) => {
        if (active) setListError(error instanceof Error ? error.message : "Could not read the drafts.");
      });
    return () => {
      active = false;
    };
  }, [date, draftStatus, stagedVersion, draftEditedAt]);

  // The shown draft, every few seconds while it runs. Errors slow the polling down; see nextDraftPoll.
  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let errors = 0;

    const load = async () => {
      let outcome: DraftPollOutcome;
      let message: string | null = null;
      try {
        const response = await fetch(`/api/approval/drafts/${selectedId}`, { cache: "no-store" });
        const body = await readJson(response);
        if (!active) return;
        if (response.ok && body.draft) {
          const next = body.draft as DraftBoardView;
          errors = 0;
          outcome = { kind: "draft", status: next.status };
          setDraft(next);
        } else {
          errors += 1;
          outcome = { kind: "error", httpStatus: response.status };
          message = String(body.error ?? "Could not read this draft.");
        }
      } catch {
        if (!active) return;
        errors += 1;
        outcome = { kind: "network" };
        message = "Could not reach the server.";
      }
      const delay = nextDraftPoll(outcome, errors);
      setDraftError(message && delay !== null ? `${message} Trying again…` : message);
      if (delay !== null) timer = setTimeout(load, delay);
    };
    void load();

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [selectedId, reload]);

  async function handleRetry() {
    if (!draft) return;
    setRetryBusy(true);
    setRetryError(null);
    try {
      const response = await fetch(`/api/approval/drafts/${draft.id}/retry`, jsonPost());
      const body = await readJson(response);
      if (!response.ok) setRetryError(String(body.error ?? "Could not retry the draft."));
    } catch {
      setRetryError("Could not reach the server. Try again.");
    } finally {
      setRetryBusy(false);
      setReload((value) => value + 1);
    }
  }

  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-10 sm:px-6">
      <div className="mx-auto max-w-6xl">
        <Link href={`/approval?${new URLSearchParams({ date })}`} className="text-sm text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
          ← Approval board
        </Link>
        <p className="mt-6 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">Draft</p>
        <h1 className="mt-2 font-serif text-[clamp(28px,4vw,40px)] leading-tight text-[var(--text-primary)]">{formatDate(date)}</h1>
        {list ? (
          <p className="mt-2 text-sm text-[var(--text-secondary)]" data-date-state={list.state.kind}>
            <span className="font-semibold text-[var(--text-primary)]">{issueStateText(list.state)}</span>
            {changeNote ? <span className="ml-2 text-[var(--accent-warm)]">{changeNote}</span> : null}
          </p>
        ) : null}
        {currentHref ? (
          <p className="mt-2 text-sm text-[var(--accent-warm)]">
            This is an older draft.{" "}
            <Link href={currentHref} className="font-medium underline">
              Open the current draft
            </Link>
          </p>
        ) : null}

        <div className="mt-8 grid gap-6 lg:grid-cols-[minmax(0,1fr)_300px]">
          <div>
            {draft && draft.id === selectedId ? (
              <DraftView
                draft={draft}
                retryBusy={retryBusy}
                retryError={retryError}
                onRetry={handleRetry}
                onChanged={() => setReload((value) => value + 1)}
              />
            ) : draftError ? (
              <Message>{draftError}</Message>
            ) : selectedId ? (
              <Message>Loading the draft…</Message>
            ) : list ? (
              <Message>No drafts for this date yet. Commit an outline on the board to make one.</Message>
            ) : (
              <Message>Loading…</Message>
            )}
            {draft && draftError ? <p className="mt-3 text-xs text-[var(--accent-warm)]">{draftError}</p> : null}
          </div>
          <aside>
            <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">Staged versions</p>
            {listError ? (
              <p className="text-sm text-[var(--accent-warm)]">{listError}</p>
            ) : list ? (
              <DraftList stagedVersions={list.stagedVersions} />
            ) : null}
          </aside>
        </div>
      </div>
    </main>
  );
}

function DraftsPageContent() {
  const searchParams = useSearchParams();
  const date = parseDate(searchParams.get("date"));
  const draftId = parseDraftId(searchParams.get("draft"));
  return <DraftsForDate key={`${date}|${draftId ?? ""}`} date={date} requestedId={draftId} />;
}

export default function ApprovalDraftsPage() {
  return (
    <Suspense fallback={null}>
      <DraftsPageContent />
    </Suspense>
  );
}
