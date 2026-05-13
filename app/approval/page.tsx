"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import ApprovalBoard from "@/components/approval/ApprovalBoard";
import {
  normalizeApprovalOutlineData,
  type ApprovalOutlineData,
  readApprovalOutlineCache,
  writeApprovalOutlineCache,
} from "@/features/newsletter/approval-outline-cache";

function parseDateKey(value: string | null): string {
  const candidate = value ? new Date(value) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return date.toISOString().slice(0, 10);
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
            Fetching and deduplicating candidates. This can take up to 30 seconds.
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
  const [outlineData, setOutlineData] = useState<ApprovalOutlineData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = readApprovalOutlineCache(dateKey);
    if (cached) {
      queueMicrotask(() => {
        setOutlineData(cached);
      });
      return;
    }

    console.log("[approval:cache] miss - fetching outline from API", { dateKey });

    const params = new URLSearchParams({ date: dateKey });
    fetch(`/api/approval/outline?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json() as Promise<{
          status: "pending" | "ready";
          batch_job_id?: string;
          outline: ApprovalOutlineData;
        }>;
      })
      .then((data) => {
        // If dedup is still pending, start polling
        if (data.status === "pending" && data.batch_job_id) {
          console.log("[approval:polling] starting batch status polling", {
            dateKey,
            batchJobId: data.batch_job_id,
          });
          startPollingBatchStatus(data.batch_job_id, dateKey);
        } else {
          // Dedup already complete, use the outline
          writeApprovalOutlineCache(dateKey, data.outline);
          setOutlineData(normalizeApprovalOutlineData(data.outline));
        }
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[approval:cache] outline fetch failed", { dateKey, message });
        setError(message);
      });

    function startPollingBatchStatus(batchJobId: string, date: string) {
      const poll = async () => {
        try {
          const statusParams = new URLSearchParams({
            batch_job_id: batchJobId,
            date: date,
          });

          console.log("[approval:polling] checking status", { 
            batchJobId, 
            date,
            timestamp: new Date().toISOString(),
          });

          const res = await fetch(
            `/api/approval/outline/status?${statusParams}`
          );

          if (!res.ok) {
            throw new Error(`Status check returned ${res.status}`);
          }

          const statusData = (await res.json()) as {
            status: "processing" | "completed" | "error";
            outline?: ApprovalOutlineData;
            error?: string;
          };

          console.log("[approval:polling] status response", {
            status: statusData.status,
            hasOutline: Boolean(statusData.outline),
            error: statusData.error,
            timestamp: new Date().toISOString(),
          });

          if (statusData.status === "completed" && statusData.outline) {
            console.log("[approval:polling] ✅ dedup completed, updating outline", {
              dateKey,
              timestamp: new Date().toISOString(),
            });
            writeApprovalOutlineCache(dateKey, statusData.outline);
            setOutlineData(normalizeApprovalOutlineData(statusData.outline));
            return;
          }

          if (statusData.status === "error") {
            console.error("[approval:polling] ❌ batch failed", {
              dateKey,
              error: statusData.error,
              timestamp: new Date().toISOString(),
            });
            setError(statusData.error || "Deduplication failed");
            return;
          }

          // Still processing, schedule next poll in 2000ms
          console.log("[approval:polling] ⏳ still processing, next check in 2s", {
            dateKey,
            timestamp: new Date().toISOString(),
          });
          setTimeout(poll, 2000);
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Unknown error";
          console.error("[approval:polling] ❌ status check failed", {
            dateKey,
            message,
            timestamp: new Date().toISOString(),
          });
          setError(message);
        }
      };

      // Start polling immediately
      console.log("[approval:polling] 🚀 starting polling", {
        batchJobId,
        dateKey,
        timestamp: new Date().toISOString(),
      });
      poll();
    }
  }, [dateKey]);

  if (error) return <ErrorState message={error} />;
  if (!outlineData) return <LoadingState />;

  return (
    <ApprovalBoard
      dateKey={dateKey}
      outlineDateLabel={formatOutlineDate(dateKey)}
      referenceStories={outlineData.reference_stories}
      candidateSections={outlineData.candidate_sections}
      candidateMap={outlineData.candidate_map}
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
