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
        return res.json() as Promise<ApprovalOutlineData>;
      })
      .then((data) => {
        const normalizedData = normalizeApprovalOutlineData(data);
        writeApprovalOutlineCache(dateKey, normalizedData);
        setOutlineData(normalizedData);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[approval:cache] outline fetch failed", { dateKey, message });
        setError(message);
      });
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
