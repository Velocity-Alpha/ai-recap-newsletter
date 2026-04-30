"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

import ApprovalBoard from "@/src/components/approval/ApprovalBoard";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CACHE_KEY_PREFIX = "approval_draft_";

type DraftData = {
  reference_stories: {
    id: number;
    day: string | null;
    headline: string;
    summary: string;
  }[];
  candidate_sections: {
    key: string;
    label: string;
    max: number;
    selected: { id: number; headline: string; summary: string }[];
    fill_ins: { id: number; headline: string; summary: string }[];
  }[];
  candidate_map: Record<string, {
    id: number;
    guid: string | null;
    day: string | null;
    headline: string | null;
    summary: string | null;
    story_details: string | null;
    category: string | null;
    source: string | null;
    url: string | null;
    importance_score: number | null;
    keyword_score: number;
    combined_score: number;
  }>;
};

type CachedEntry = {
  data: DraftData;
  cachedAt: number;
};

function parseDateKey(value: string | null): string {
  const candidate = value ? new Date(value) : new Date();
  const date = Number.isNaN(candidate.getTime()) ? new Date() : candidate;
  return date.toISOString().slice(0, 10);
}

function formatDraftDate(dateKey: string): string {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateKey));
}

function readCache(dateKey: string): DraftData | null {
  try {
    const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${dateKey}`);
    if (!raw) return null;
    const entry: CachedEntry = JSON.parse(raw);
    if (Date.now() - entry.cachedAt > CACHE_TTL_MS) {
      localStorage.removeItem(`${CACHE_KEY_PREFIX}${dateKey}`);
      console.log("[approval:cache] expired", { dateKey });
      return null;
    }
    console.log("[approval:cache] hit", { dateKey, cachedAt: new Date(entry.cachedAt).toISOString() });
    return entry.data;
  } catch {
    return null;
  }
}

function writeCache(dateKey: string, data: DraftData): void {
  try {
    const entry: CachedEntry = { data, cachedAt: Date.now() };
    localStorage.setItem(`${CACHE_KEY_PREFIX}${dateKey}`, JSON.stringify(entry));
    console.log("[approval:cache] stored", { dateKey });
  } catch {
    // localStorage may be full or unavailable — not a hard failure
  }
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

export default function ApprovalPage() {
  const searchParams = useSearchParams();
  const dateKey = parseDateKey(searchParams.get("date"));
  const [draftData, setDraftData] = useState<DraftData | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const cached = readCache(dateKey);
    if (cached) {
      setDraftData(cached);
      return;
    }

    console.log("[approval:cache] miss — fetching from API", { dateKey });

    const params = new URLSearchParams({ date: dateKey });
    fetch(`/api/approval/draft?${params}`)
      .then((res) => {
        if (!res.ok) throw new Error(`Server returned ${res.status}`);
        return res.json() as Promise<DraftData>;
      })
      .then((data) => {
        writeCache(dateKey, data);
        setDraftData(data);
      })
      .catch((err: unknown) => {
        const message = err instanceof Error ? err.message : "Unknown error";
        console.error("[approval:cache] fetch failed", { dateKey, message });
        setError(message);
      });
  }, [dateKey]);

  if (error) return <ErrorState message={error} />;
  if (!draftData) return <LoadingState />;

  return (
    <ApprovalBoard
      draftDateLabel={formatDraftDate(dateKey)}
      referenceStories={draftData.reference_stories}
      candidateSections={draftData.candidate_sections}
      candidateMap={draftData.candidate_map}
    />
  );
}
