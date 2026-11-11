"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import ApprovalBoard from "@/components/approval/ApprovalBoard";
import NewStoriesNotice from "@/components/approval/NewStoriesNotice";
import { approvalDateKey } from "@/features/newsletter/approval-date";
import {
  approvalOutlineCacheId,
  cachedOutlineAction,
  clearApprovalOutlineCache,
  isApprovalOutlineCacheEdited,
  markApprovalOutlineCacheEdited,
  normalizeApprovalOutlineData,
  type ApprovalOutlineData,
  readApprovalOutlineCache,
  writeApprovalOutlineCache,
} from "@/features/newsletter/approval-outline-cache";
import {
  parseReuseDraftDates,
  toggleReuseDraftDate,
} from "@/features/newsletter/reuse-drafts-param";
import type { DateDraftsView } from "@/src/pipeline/draft/draft-board";
import type { ReasonCodes } from "@/src/pipeline/feedback/default-reason-codes";
import { awaitLeadPick } from "@/features/newsletter/lead-pick-client";
import { applyLeadPick } from "@/features/newsletter/lead-story";

function parseDateKey(value: string | null): string {
  return approvalDateKey(value);
}

function formatOutlineDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateKey));
}

function LoadingState() {
  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-12 sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-10 text-center shadow-[0_30px_80px_rgba(61,79,95,0.12)] sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
            Please wait
          </p>
          <h1 className="mt-3 font-serif text-[clamp(30px,5vw,46px)] leading-tight text-[var(--text-primary)]">
            Getting stories…
          </h1>
          <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">
            Building the board from the latest stories.
          </p>
          <div className="mt-8 flex justify-center gap-1.5">
            <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-primary)] [animation-delay:0ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-primary)] [animation-delay:150ms]" />
            <span className="h-2 w-2 animate-bounce rounded-full bg-[var(--accent-primary)] [animation-delay:300ms]" />
          </div>
        </div>
      </div>
    </main>
  );
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="min-h-screen bg-[var(--bg-main)] px-4 py-12 sm:px-6">
      <div className="mx-auto flex min-h-[70vh] max-w-2xl items-center justify-center">
        <div className="w-full rounded-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] px-6 py-10 text-center shadow-[0_30px_80px_rgba(61,79,95,0.12)] sm:px-10">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-red-500">
            Error
          </p>
          <h1 className="mt-3 font-serif text-[clamp(30px,5vw,46px)] leading-tight text-[var(--text-primary)]">
            Something went wrong
          </h1>
          <p className="mt-4 text-base leading-7 text-[var(--text-secondary)]">{message}</p>
        </div>
      </div>
    </main>
  );
}

function ApprovalPageContent() {
  const searchParams = useSearchParams();
  const dateKey = parseDateKey(searchParams.get("date"));
  // Comma-separated dates of unsent drafts whose stories go back into the pool.
  const reuseKey = parseReuseDraftDates(searchParams.get("reuse")).join(",");

  return (
    <ApprovalPageForDate key={`${dateKey}|${reuseKey}`} dateKey={dateKey} reuseKey={reuseKey} />
  );
}

function ApprovalPageForDate({ dateKey, reuseKey }: { dateKey: string; reuseKey: string }) {
  const router = useRouter();
  const cacheId = approvalOutlineCacheId(dateKey, reuseKey ? reuseKey.split(",") : []);
  const [outlineData, setOutlineData] = useState<ApprovalOutlineData | null>(null);
  // Bumped to build the board again from the latest stories.
  const [buildCount, setBuildCount] = useState(0);
  const [hasNewStories, setHasNewStories] = useState(false);
  const rebuildBoard = useCallback(() => {
    clearApprovalOutlineCache(cacheId);
    setHasNewStories(false);
    setOutlineData(null);
    setBuildCount((count) => count + 1);
  }, [cacheId]);
  const handleBoardEdit = useCallback(() => markApprovalOutlineCacheEdited(cacheId), [cacheId]);
  const [publishStatus, setPublishStatus] = useState<{
    target_date: string;
    has_exact_match: boolean;
    issue: {
      id: string;
      slug: string | null;
      title: string;
      issue_date: string | null;
      published_at: string | null;
    } | null;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The date's state and drafts. Null if the read fails: the board then shows no state and no draft link.
  const [drafting, setDrafting] = useState<DateDraftsView | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/approval/drafts?${new URLSearchParams({ date: dateKey })}`, { cache: "no-store" })
      .then((res) => (res.ok ? (res.json() as Promise<DateDraftsView>) : null))
      .then((data) => {
        if (active) setDrafting(data?.state && Array.isArray(data.stagedVersions) ? data : null);
      })
      .catch(() => {
        if (active) setDrafting(null);
      });
    return () => {
      active = false;
    };
  }, [dateKey]);

  useEffect(() => {
    let active = true;
    const params = new URLSearchParams({ date: dateKey });

    fetch(`/api/newsletters/publish-status?${params}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Publish status returned ${res.status}`);
        }

        return res.json() as Promise<{
          success: boolean;
          target_date: string;
          has_exact_match: boolean;
          issue: {
            id: string;
            slug: string | null;
            title: string;
            issue_date: string | null;
            published_at: string | null;
          } | null;
        }>;
      })
      .then((data) => {
        if (!active) return;

        setPublishStatus({
          target_date: data.target_date,
          has_exact_match: data.has_exact_match,
          issue: data.issue,
        });
      })
      .catch((err: unknown) => {
        if (!active) return;

        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[approval:publish-status] failed", { dateKey, message });
        setPublishStatus(null);
      });

    return () => {
      active = false;
    };
  }, [dateKey]);

  useEffect(() => {
    let active = true;

    const cached = readApprovalOutlineCache(cacheId);
    if (cached) {
      queueMicrotask(() => {
        if (active) setOutlineData(cached);
      });
      // Show the cached board at once, then check whether newer stories arrived since it was built.
      fetch(`/api/approval/outline/marker?${new URLSearchParams({ date: dateKey })}`, {
        cache: "no-store",
      })
        .then((res) => (res.ok ? (res.json() as Promise<{ candidate_marker: number | null }>) : null))
        .then((marker) => {
          if (!active || !marker) return;
          const action = cachedOutlineAction({
            cachedMarker: cached.candidate_marker,
            currentMarker: marker.candidate_marker,
            edited: isApprovalOutlineCacheEdited(cacheId),
          });
          console.log("[approval:cache] marker checked", { dateKey, action });
          if (action === "rebuild") rebuildBoard();
          if (action === "offer-rebuild") setHasNewStories(true);
        })
        .catch((err: unknown) => {
          // The cached board stays usable when the check fails.
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[approval:cache] marker check failed", { dateKey, message });
        });
      return () => {
        active = false;
      };
    }

    console.log("[approval:cache] miss - fetching outline from API", { dateKey });

    const params = new URLSearchParams({ date: dateKey });
    if (reuseKey) params.set("reuse", reuseKey);
    fetch(`/api/approval/outline?${params}`)
      .then((outlineResponse) => {
        if (!outlineResponse.ok) throw new Error(`Server returned ${outlineResponse.status}`);
        return outlineResponse.json() as Promise<{
          status: "ready";
          outline: ApprovalOutlineData;
          lead_response_id?: string | null;
          reason_codes?: ReasonCodes;
        }>;
      })
      .then((outlinePayload) => {
        if (!active) return;
        const outline = { ...outlinePayload.outline, reason_codes: outlinePayload.reason_codes };
        writeApprovalOutlineCache(cacheId, outline);
        setOutlineData(normalizeApprovalOutlineData(outline));
        if (outlinePayload.lead_response_id) {
          applyLeadPickWhenReady(outlinePayload.lead_response_id, outline);
        }
      })
      .catch((err: unknown) => {
        if (!active) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[approval:cache] outline fetch failed", { dateKey, message });
        setError(message);
      });

    // The board opens with the scored lead. The AI's pick replaces it only if the owner has not edited the board.
    function applyLeadPickWhenReady(leadResponseId: string, outline: ApprovalOutlineData) {
      void awaitLeadPick(leadResponseId, { isActive: () => active }).then((pick) => {
        if (!pick || !active || isApprovalOutlineCacheEdited(cacheId)) return;
        const picked = applyLeadPick(outline, pick);
        if (picked === outline) return;
        console.log("[approval:lead] AI lead pick applied", { dateKey, leadId: pick.leadId });
        writeApprovalOutlineCache(cacheId, picked);
        setOutlineData(normalizeApprovalOutlineData(picked));
      });
    }

    return () => {
      active = false;
    };
  }, [dateKey, reuseKey, cacheId, buildCount, rebuildBoard]);

  const handleToggleDraftReuse = (draftDate: string) => {
    const reuse = toggleReuseDraftDate(reuseKey ? reuseKey.split(",") : [], draftDate);
    const params = new URLSearchParams({ date: dateKey });
    if (reuse) params.set("reuse", reuse);
    router.replace(`/approval?${params}`);
  };

  if (error) return <ErrorState message={error} />;
  if (!outlineData) return <LoadingState />;

  return (
    <ApprovalBoard
      dateKey={dateKey}
      unsentDrafts={outlineData.unsent_drafts ?? []}
      onToggleDraftReuse={handleToggleDraftReuse}
      onEdit={handleBoardEdit}
      headerNotice={hasNewStories ? <NewStoriesNotice onRebuild={rebuildBoard} /> : null}
      outlineDateLabel={formatOutlineDate(dateKey)}
      referenceStories={outlineData.reference_stories}
      candidateSections={outlineData.candidate_sections}
      candidateMap={outlineData.candidate_map}
      proposedLeadId={outlineData.proposed_lead_id ?? null}
      proposedLeadReason={outlineData.proposed_lead_reason ?? null}
      publishStatus={publishStatus}
      repeatsRemoved={outlineData.repeats_removed}
      repeatCheckIncomplete={outlineData.repeat_check_incomplete ?? false}
      reasonCodes={outlineData.reason_codes}
      onRebuild={rebuildBoard}
      drafting={drafting}
    />
  );
}

export default function ApprovalPage() {
  return (
    <Suspense fallback={<LoadingState />}>
      <ApprovalPageContent />
    </Suspense>
  );
}
