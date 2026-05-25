"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ExternalLink,
  Flag,
  GripVertical,
  Hammer,
  PanelLeftClose,
  PanelLeftOpen,
  BookOpen,
  Pencil,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";

import { Button } from "@/components/ui/button";

type StoryOption = {
  id: number;
  headline: string;
  summary: string;
};

type CandidateSection = {
  key: string;
  label: string;
  max: number;
  selected: StoryOption[];
  fill_ins: StoryOption[];
};

type CandidateMapEntry = {
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
};

type ReferenceStory = {
  id: number;
  day: string | null;
  headline: string;
  summary: string;
};

type ApprovalBoardProps = {
  dateKey: string;
  outlineDateLabel: string;
  referenceStories: ReferenceStory[];
  candidateSections: CandidateSection[];
  candidateMap: Record<string, CandidateMapEntry>;
  dedupFailureReason: string | null;
  publishStatus: {
    target_date: string;
    has_exact_match: boolean;
    issue: {
      id: string;
      slug: string | null;
      title: string;
      issue_date: string | null;
      published_at: string | null;
    } | null;
  } | null;
};

type PreviewStory = CandidateMapEntry & {
  status: "selected" | "fill-in";
  sectionLabel: string;
};

type StorySlot = { story: StoryOption; status: "selected" | "fill-in" };

type SectionState = {
  key: string;
  label: string;
  max: number;
  stories: StorySlot[];
};

type ExcludeState = {
  excluded: boolean;
  reason: string;
};

const SECTION_ICONS: Record<string, typeof Star> = {
  headlines: Flag,
  research: BookOpen,
  tools: Hammer,
  quickHits: Zap,
};

function initSections(candidateSections: CandidateSection[]): SectionState[] {
  return candidateSections.map((s) => ({
    key: s.key,
    label: s.label,
    max: s.max,
    stories: [
      ...s.selected.map((story) => ({ story, status: "selected" as const })),
      ...s.fill_ins.map((story) => ({ story, status: "fill-in" as const })),
    ],
  }));
}

function formatLongDate(value: string | null | undefined): string {
  if (!value) return "Unknown";

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";

  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(parsed);
}

export default function ApprovalBoard({
  dateKey,
  outlineDateLabel,
  referenceStories,
  candidateSections,
  candidateMap,
  dedupFailureReason,
  publishStatus,
}: ApprovalBoardProps) {
  const router = useRouter();
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResponseMessage, setCommitResponseMessage] = useState<string | null>(null);
  const [commitErrorMessage, setCommitErrorMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewStoryId, setPreviewStoryId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionState[]>(() => initSections(candidateSections));
  const [headlineStoryId, setHeadlineStoryId] = useState<number | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [excludeState, setExcludeState] = useState<Record<number, ExcludeState>>({});
  const [urlOverrides, setUrlOverrides] = useState<Record<number, string>>({});
  const [editingPreviewId, setEditingPreviewId] = useState<number | null>(null);
  const [notesOverrides, setNotesOverrides] = useState<Record<number, string>>({});
  const dragStory = useRef<{ storyId: number; fromSectionKey: string } | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);

  useEffect(() => {
    setSections(initSections(candidateSections));
  }, [candidateSections]);

  const toggleExpand = (id: number) =>
    setExpandedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });

  const demoteStoryToFillIn = (storyId: number) => {
    setSections((prev) =>
      prev.map((section) => ({
        ...section,
        stories: section.stories.map((slot) =>
          slot.story.id === storyId ? { ...slot, status: "fill-in" as const } : slot
        ),
      }))
    );
  };

  const toggleExclude = (id: number) => {
    const nextExcluded = !(excludeState[id]?.excluded ?? false);

    setExcludeState((prev) => ({
      ...prev,
      [id]: { excluded: nextExcluded, reason: prev[id]?.reason ?? "" },
    }));

    if (nextExcluded) {
      demoteStoryToFillIn(id);
    }
  };

  const setExcludeReason = (id: number, reason: string) => {
    setExcludeState((prev) => ({ ...prev, [id]: { ...prev[id], excluded: true, reason } }));
    demoteStoryToFillIn(id);
  };

  const updateStoryStatus = (storyId: number, sectionKey: string, nextStatus: "selected" | "fill-in") => {
    if (nextStatus === "selected") {
      setExcludeState((prev) => {
        if (!prev[storyId]?.excluded) {
          return prev;
        }

        return {
          ...prev,
          [storyId]: {
            excluded: false,
            reason: prev[storyId]?.reason ?? "",
          },
        };
      });
    }

    setSections((prev) =>
      prev.map((section) => {
        if (section.key !== sectionKey) return section;

        return {
          ...section,
          stories: section.stories.map((slot) =>
            slot.story.id === storyId ? { ...slot, status: nextStatus } : slot
          ),
        };
      })
    );
  };

  // Drag handlers
  const onDragStart = (storyId: number, fromSectionKey: string) => {
    dragStory.current = { storyId, fromSectionKey };
  };

  const moveStory = (storyId: number, fromSectionKey: string, toSectionKey: string) => {
    if (fromSectionKey === toSectionKey) return;
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, stories: [...s.stories] }));
      const from = next.find((s) => s.key === fromSectionKey);
      const to = next.find((s) => s.key === toSectionKey);
      if (!from || !to) return prev;
      const idx = from.stories.findIndex((slot) => slot.story.id === storyId);
      if (idx === -1) return prev;
      const [moved] = from.stories.splice(idx, 1);
      to.stories.push(moved);
      return next;
    });
  };

  const onDrop = (toSectionKey: string) => {
    const drag = dragStory.current;
    if (!drag || drag.fromSectionKey === toSectionKey) {
      setDragOverSection(null);
      return;
    }
    setSections((prev) => {
      const next = prev.map((s) => ({ ...s, stories: [...s.stories] }));
      const from = next.find((s) => s.key === drag.fromSectionKey);
      const to = next.find((s) => s.key === toSectionKey);
      if (!from || !to) return prev;
      const idx = from.stories.findIndex((slot) => slot.story.id === drag.storyId);
      if (idx === -1) return prev;
      const [moved] = from.stories.splice(idx, 1);
      to.stories.push(moved);
      return next;
    });
    dragStory.current = null;
    setDragOverSection(null);
  };

  const headlineStoryTitle = useMemo(() => {
    if (headlineStoryId === null) return null;
    for (const section of sections) {
      const slot = section.stories.find((s) => s.story.id === headlineStoryId);
      if (slot) return slot.story.headline;
    }
    return null;
  }, [headlineStoryId, sections]);

  const totals = useMemo(() => {
    const sectionSummaries = sections.map((section) => {
      const selected = section.stories.filter((s) => s.status === "selected").length;
      return {
        key: section.key,
        label: section.label,
        selectedCount: selected,
        totalCount: section.stories.length,
        max: section.max,
        isOverflowing: selected > section.max,
      };
    });
    return {
      sections: sectionSummaries,
      hasOverflow: sectionSummaries.some((s) => s.isOverflowing),
      selectedCount: sectionSummaries.reduce((sum, s) => sum + s.selectedCount, 0),
      totalCount: sectionSummaries.reduce((sum, s) => sum + s.totalCount, 0),
    };
  }, [sections]);

  const previewStory = useMemo<PreviewStory | null>(() => {
    if (previewStoryId === null) return null;
    for (const section of sections) {
      const slot = section.stories.find((s) => s.story.id === previewStoryId);
      if (slot) {
        const full = candidateMap[String(previewStoryId)];
        if (full) return { ...full, status: slot.status, sectionLabel: section.label };
      }
    }
    return null;
  }, [candidateMap, sections, previewStoryId]);

  const validationErrors = useMemo(() => {
    const errors: string[] = [];

    if (!headlineStoryId) {
      errors.push("Choose a newsletter headline before committing the outline.");
    }

    for (const section of totals.sections) {
      if (section.isOverflowing) {
        errors.push(`${section.label} exceeds its selected limit (${section.selectedCount}/${section.max}).`);
      }
    }

    for (const section of sections) {
      for (const slot of section.stories) {
        const isExcluded = excludeState[slot.story.id]?.excluded ?? false;
        const isHeadline = headlineStoryId === slot.story.id;

        if (isHeadline && (isExcluded || slot.status === "fill-in")) {
          errors.push(`Headline story \"${slot.story.headline}\" must stay selected and included.`);
        }
      }
    }

    return Array.from(new Set(errors));
  }, [excludeState, headlineStoryId, sections, totals.sections]);

  const publishDateBlockError =
    publishStatus?.has_exact_match === true
      ? `An issue is already published for ${formatLongDate(publishStatus.target_date)}.`
      : null;

  const commitDisabled = validationErrors.length > 0 || Boolean(publishDateBlockError);

  const commitPayload = useMemo(() => {
    const candidateSections = sections.map((section) => {
      const selected = section.stories
        .filter((slot) => slot.status === "selected")
        .map((slot) => ({
          id: slot.story.id,
          headline: slot.story.headline,
          summary: slot.story.summary,
          note: notesOverrides[slot.story.id] ?? "",
        }));

      const fill_ins = section.stories
        .filter((slot) => slot.status === "fill-in")
        .map((slot) => ({
          id: slot.story.id,
          headline: slot.story.headline,
          summary: slot.story.summary,
          note: notesOverrides[slot.story.id] ?? "",
        }));

      return {
        key: section.key,
        label: section.label,
        max: section.max,
        selected,
        fill_ins,
      };
    });

    const approvedIdsBySection = Object.fromEntries(
      candidateSections.map((section) => [
        section.key,
        section.selected.map((story) => story.id),
      ])
    );

    const allVisibleStories = sections.flatMap((section) =>
      section.stories.map((slot) => {
        const candidate = candidateMap[String(slot.story.id)];
        const exclude = excludeState[slot.story.id];

        return {
          slot,
          section,
          candidate,
          exclude,
        };
      })
    );

    const excludedStories = allVisibleStories
      .filter(({ exclude }) => exclude?.excluded)
      .map(({ slot, section, exclude }) => ({
        id: slot.story.id,
        headline: slot.story.headline,
        summary: slot.story.summary,
        note: notesOverrides[slot.story.id] ?? "",
        reason: exclude?.reason ?? "",
        newsletter_category: section.key,
      }));

    const candidateMapPayload = Object.fromEntries(
      allVisibleStories.flatMap(({ slot, candidate }) => {
        if (!candidate) return [];

        return [
          [
            String(slot.story.id),
            {
              id: candidate.id,
              guid: candidate.guid ?? null,
              day: candidate.day ?? null,
              headline: slot.story.headline,
              url: urlOverrides[slot.story.id] ?? candidate.url ?? null,
              summary: slot.story.summary,
              note: notesOverrides[slot.story.id] ?? "",
              category: candidate.category ?? null,
              source: candidate.source ?? null,
              story_details: candidate.story_details ?? null,
              importance_score: candidate.importance_score ?? null,
              keyword_score: candidate.keyword_score,
              combined_score: candidate.combined_score,
            },
          ],
        ];
      })
    );

    const selectedStoryIds = candidateSections.flatMap((section) =>
      section.selected.map((story) => story.id)
    );

    const stories = allVisibleStories.flatMap(({ slot, section, candidate }) => {
      if (!candidate) return [];

      return [
        {
          id: candidate.id,
          guid: candidate.guid ?? null,
          day: candidate.day ?? null,
          headline: slot.story.headline,
          url: urlOverrides[slot.story.id] ?? candidate.url ?? null,
          summary: slot.story.summary,
          note: notesOverrides[slot.story.id] ?? "",
          source: candidate.source ?? null,
          story_details: candidate.story_details ?? null,
          importance_score: candidate.importance_score ?? null,
          keyword_score: candidate.keyword_score,
          combined_score: candidate.combined_score,
          source_category: candidate.category ?? null,
          newsletter_category: section.key,
        },
      ];
    });

    return {
      date: dateKey,
      approved_ids_by_section: approvedIdsBySection,
      excluded_stories: excludedStories,
      newsletter_headline: headlineStoryId,
      candidate_sections: candidateSections,
      candidate_map: candidateMapPayload,
      selected_story_ids: selectedStoryIds,
      stories,
      queue_update_count: selectedStoryIds.length,
    };
  }, [candidateMap, dateKey, excludeState, headlineStoryId, notesOverrides, sections, urlOverrides]);

  const handleCommitOutline = () => {
    setCommitResponseMessage(null);
    setCommitErrorMessage(null);
    setCommitModalOpen(true);
  };

  const handleCommitContinue = async () => {
    setIsCommitting(true);
    setCommitErrorMessage(null);
    setCommitResponseMessage(null);

    try {
      const response = await fetch("/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(commitPayload),
      });

      const commitResponseBody = (await response.json()) as {
        success?: boolean;
        message?: string;
        error?: string;
      };

      if (!response.ok || !commitResponseBody.success) {
        throw new Error(
          commitResponseBody.error ||
            commitResponseBody.message ||
            "Outline commit request failed."
        );
      }

      setCommitResponseMessage(
        commitResponseBody.message || "Outline committed for generation."
      );
      setCommitModalOpen(false);
      router.push("/approval/submitted");
    } catch (error) {
      setCommitErrorMessage(error instanceof Error ? error.message : "Unknown outline commit error.");
    } finally {
      setIsCommitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[var(--bg-main)]">
      {/* Stats header */}
      <header className="sticky top-0 z-30 border-b border-[var(--border-light)] bg-[rgba(250,250,248,0.75)] backdrop-blur-md">
        <div className="flex items-center gap-2 overflow-x-auto px-4 py-2 sm:px-6 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {/* Sidebar toggle */}
          <button
            onClick={() => setSidebarOpen((v) => !v)}
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-[var(--border-light)] bg-white/60 text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
            aria-label={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
          >
            {sidebarOpen ? <PanelLeftClose className="h-3.5 w-3.5" /> : <PanelLeftOpen className="h-3.5 w-3.5" />}
          </button>

          <div className="mx-2 h-4 w-px shrink-0 bg-[var(--border-light)]" />

          <div className="flex shrink-0 items-center rounded-full border border-[var(--border-light)] bg-white/70 px-3 py-1 text-[11px] font-medium text-[var(--text-secondary)]">
            {outlineDateLabel}
          </div>

          {/* Per-section pills */}
          {totals.sections.map((section) => {
            const SectionIcon = SECTION_ICONS[section.key] ?? Sparkles;

            return (
              <div
                key={section.key}
                className={`flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 ${
                  section.isOverflowing
                    ? "border-[rgba(184,133,110,0.36)] bg-[rgba(255,244,236,0.85)]"
                    : "border-[var(--border-light)] bg-white/70"
                }`}
              >
                <SectionIcon
                  className={`h-3 w-3 ${section.isOverflowing ? "text-[var(--accent-warm)]" : "text-[var(--text-muted)]"}`}
                />
                <span className={`text-[13px] font-semibold ${section.isOverflowing ? "text-[var(--accent-warm)]" : "text-[var(--text-primary)]"}`}>
                  {section.selectedCount}/{section.max}
                </span>
                {section.isOverflowing && <TriangleAlert className="h-3 w-3 text-[var(--accent-warm)]" />}
              </div>
            );
          })}

          {/* Headline pill */}
          <div className="mx-1 h-4 w-px shrink-0 bg-[var(--border-light)]" />
          {headlineStoryTitle ? (
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-[rgba(107,155,184,0.3)] bg-[rgba(232,242,248,0.7)] px-3 py-1 max-w-[220px]">
              <Star className="h-3 w-3 shrink-0 fill-[var(--accent-primary)] text-[var(--accent-primary)]" />
              <span className="truncate text-[11px] font-medium text-[var(--accent-primary)]">{headlineStoryTitle}</span>
            </div>
          ) : (
            <div className="flex shrink-0 items-center gap-1.5 rounded-full border border-dashed border-[var(--border-light)] px-3 py-1">
              <Star className="h-3 w-3 shrink-0 text-[var(--text-muted)]" />
            </div>
          )}

          <div className="ml-auto shrink-0 pl-2">
            <Button
              className={`px-3 py-1.5 text-xs font-medium text-white transition ${
                publishDateBlockError
                  ? "bg-red-600 hover:bg-red-700 disabled:bg-red-500 disabled:cursor-not-allowed disabled:opacity-75"
                  : "bg-[var(--text-primary)] hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-50"
              }`}
              onClick={handleCommitOutline}
              disabled={commitDisabled}
            >
              Commit
            </Button>
          </div>
        </div>
        {publishStatus ? (
          <div className={`border-t px-4 py-3 sm:px-6 ${
            publishDateBlockError
              ? "border-red-300 bg-red-50"
              : "border-[var(--border-light)] bg-white/50"
          }`}>
            <p
              className={`text-sm font-semibold ${
                publishDateBlockError
                  ? "text-red-700"
                  : "text-[var(--text-secondary)]"
              }`}
            >
              {publishDateBlockError
                ? publishDateBlockError
                : publishStatus.issue
                  ? `Latest published before ${publishStatus.target_date}: ${
                      formatLongDate(publishStatus.issue.issue_date)
                    }.`
                  : `No published issue found on or before ${formatLongDate(publishStatus.target_date)}.`}
            </p>
          </div>
        ) : null}
        {dedupFailureReason ? (
          <div className="border-t border-red-300 bg-red-50 px-4 py-3 sm:px-6">
            <p className="text-sm font-semibold text-red-700">
              Deduplication failed. Using original candidate set. Reason: {dedupFailureReason}
            </p>
          </div>
        ) : null}
      </header>

      <div className="flex flex-1">
        {/* Collapsible sidebar */}
        <aside
          className={`shrink-0 border-r border-[var(--border-light)] bg-[rgba(255,255,255,0.82)] transition-all duration-300 ${sidebarOpen ? "w-72 xl:w-80" : "w-0 overflow-hidden"}`}
        >
          <div className="sticky top-[49px] flex h-[calc(100vh-49px)] flex-col">
            <div className="border-b border-[var(--border-light)] px-5 py-4">
              <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
                Previously Published
              </p>
              <h2 className="mt-1 font-serif text-lg text-[var(--text-primary)]">Reference stories</h2>
              <p className="mt-1 text-xs leading-5 text-[var(--text-secondary)]">
                Avoid repeating these in the current issue.
              </p>
            </div>

            <div className="flex-1 overflow-y-auto">
              {referenceStories.length > 0 ? (
                (() => {
                  const grouped = referenceStories.reduce<Record<string, ReferenceStory[]>>(
                    (acc, story) => {
                      const key = story.day ?? "Unknown date";
                      (acc[key] ??= []).push(story);
                      return acc;
                    },
                    {},
                  );
                  const sortedDates = Object.keys(grouped).sort((a, b) =>
                    b.localeCompare(a),
                  );
                  return sortedDates.map((date) => (
                    <div key={date}>
                      <div className="sticky top-0 bg-[var(--bg-card)] px-5 py-1.5 border-b border-[var(--border-light)]">
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[var(--text-secondary)]">
                          {date === "Unknown date"
                            ? "Unknown date"
                            : new Intl.DateTimeFormat("en-US", {
                                month: "short",
                                day: "numeric",
                                year: "numeric",
                                timeZone: "UTC",
                              }).format(new Date(date + "T00:00:00Z"))}
                        </p>
                      </div>
                      <div className="divide-y divide-[var(--border-light)]">
                        {grouped[date].map((story) => (
                          <div key={story.id} className="flex items-start gap-3 px-5 py-3">
                            <div className="min-w-0">
                              <p className="text-sm font-medium leading-snug text-[var(--text-primary)] line-clamp-2">
                                {story.headline}
                              </p>
                              {story.summary ? (
                                <p className="mt-0.5 text-xs leading-5 text-[var(--text-secondary)] line-clamp-2">
                                  {story.summary}
                                </p>
                              ) : null}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ));
                })()
              ) : (
                <div className="px-5 py-6 text-xs text-[var(--text-secondary)]">
                  No recent reference stories for this date.
                </div>
              )}
            </div>

            {/* Collapse button at bottom */}
            <div className="border-t border-[var(--border-light)] p-3">
              <button
                onClick={() => setSidebarOpen(false)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-xs text-[var(--text-secondary)] hover:bg-[var(--bg-warm)] transition"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
                Collapse sidebar
              </button>
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6">
          {/* Collapsed sidebar peek button */}
          {!sidebarOpen && (
            <button
              onClick={() => setSidebarOpen(true)}
              className="mb-6 flex items-center gap-2 rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-xs font-medium text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition"
            >
              <ChevronRight className="h-3.5 w-3.5" />
              {referenceStories.length} reference stories
            </button>
          )}

          <div className="space-y-10">
            {sections.map((section) => {
              const selectedCount = section.stories.filter((s) => s.status === "selected").length;
              const isOverflowing = selectedCount > section.max;
              const isDragTarget = dragOverSection === section.key;

              return (
                <div
                  key={section.key}
                  onDragOver={(e) => { e.preventDefault(); setDragOverSection(section.key); }}
                  onDragLeave={() => setDragOverSection(null)}
                  onDrop={() => onDrop(section.key)}
                >
                  {/* Section header */}
                  <div className="mb-3 flex items-center justify-between gap-4 border-b border-[var(--border-light)] pb-3">
                    <div className="flex items-baseline gap-3">
                      <h2 className="font-serif text-xl text-[var(--text-primary)]">{section.label}</h2>
                      <span
                        className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold ${
                          isOverflowing
                            ? "border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] text-[var(--accent-warm)]"
                            : "border-[rgba(107,155,184,0.18)] bg-[rgba(232,242,248,0.7)] text-[var(--watercolor-ink)]"
                        }`}
                      >
                        {selectedCount}/{section.max}
                      </span>
                    </div>
                    <span className="text-xs text-[var(--text-secondary)]">
                      {section.stories.filter((s) => s.status === "fill-in").length} fill-ins
                    </span>
                  </div>

                  {/* Drop zone */}
                  <div
                    className={`divide-y divide-[var(--border-light)] overflow-hidden rounded-xl border bg-white transition-colors ${
                      isDragTarget
                        ? "border-[var(--accent-primary)] ring-2 ring-[var(--accent-primary)] ring-opacity-20"
                        : "border-[var(--border-light)]"
                    }`}
                  >
                    {section.stories.length > 0 ? (
                      section.stories.map(({ story, status }) => {
                        const full = candidateMap[String(story.id)];
                        const isExpanded = expandedIds.has(story.id);
                        const excl = excludeState[story.id];
                        const isExcluded = excl?.excluded ?? false;
                        const isHeadline = headlineStoryId === story.id;
                        const hasHeadlineValidationError = isHeadline && (isExcluded || status === "fill-in");

                        return (
                          <div
                            key={story.id}
                            draggable
                            onDragStart={() => onDragStart(story.id, section.key)}
                            className={`cursor-grab select-none transition ${
                              hasHeadlineValidationError
                                ? "bg-[rgba(255,244,236,0.96)] ring-1 ring-inset ring-[rgba(184,133,110,0.36)]"
                                : isExcluded
                                ? "bg-[rgba(0,0,0,0.03)] opacity-60"
                                : status === "fill-in"
                                ? "bg-[rgba(247,246,243,0.92)] opacity-75"
                                : isHeadline
                                ? "bg-[rgba(232,242,248,0.45)]"
                                : "bg-white hover:bg-[var(--bg-warm)]"
                            }`}
                          >
                            {/* Collapsed row */}
                            <div className="flex items-center gap-3 px-4 py-3">
                              {/* Drag handle */}
                              <GripVertical
                                className={`h-4 w-4 shrink-0 ${
                                  hasHeadlineValidationError
                                    ? "text-[var(--accent-warm)]"
                                    : isExcluded
                                    ? "text-red-300"
                                    : isHeadline
                                    ? "text-[var(--accent-primary)]"
                                    : status === "selected"
                                    ? "text-[var(--watercolor-blue-deep)]"
                                    : "text-[rgba(157,180,160,0.9)]"
                                }`}
                              />

                              {/* Headline star */}
                              {isHeadline && (
                                <Star className="h-3.5 w-3.5 shrink-0 fill-[var(--accent-primary)] text-[var(--accent-primary)]" />
                              )}

                              {/* Text */}
                              <div className="min-w-0 flex-1">
                                <p className={`truncate text-sm font-medium ${
                                  hasHeadlineValidationError
                                    ? "text-[var(--accent-warm)]"
                                    : isExcluded
                                    ? "line-through text-[var(--text-muted)]"
                                    : status === "fill-in"
                                    ? "text-[var(--text-secondary)]"
                                    : "text-[var(--text-primary)]"
                                }`}>
                                  {story.headline}
                                </p>
                                {hasHeadlineValidationError ? (
                                  <p className="mt-1 truncate text-[11px] font-medium text-[var(--accent-warm)]">
                                    Headline story must stay selected and included.
                                  </p>
                                ) : null}
                                {!isExpanded && story.summary ? (
                                  <p className={`truncate text-xs ${status === "fill-in" ? "text-[var(--text-muted)]" : "text-[var(--text-secondary)]"}`}>
                                    {story.summary}
                                  </p>
                                ) : null}
                              </div>

                              {/* Quick actions */}
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  onClick={() =>
                                    updateStoryStatus(
                                      story.id,
                                      section.key,
                                      status === "selected" ? "fill-in" : "selected"
                                    )
                                  }
                                  className={`inline-flex h-7 items-center justify-center rounded-full border px-2.5 text-[11px] font-medium transition ${
                                    status === "selected"
                                      ? "border-[rgba(107,155,184,0.24)] bg-[rgba(232,242,248,0.8)] text-[var(--watercolor-ink)] hover:border-[var(--accent-primary)]"
                                      : "border-[rgba(157,180,160,0.24)] bg-[rgba(235,242,237,0.9)] text-[var(--watercolor-sage)] hover:border-[var(--watercolor-sage)]"
                                  }`}
                                >
                                  {status === "selected" ? "Selected" : "Select"}
                                </button>
                                <button
                                  onClick={() => toggleExclude(story.id)}
                                  className={`inline-flex h-7 w-7 items-center justify-center rounded-full border transition ${
                                    isExcluded
                                      ? "border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] text-[var(--accent-warm)]"
                                      : "border-[var(--border-light)] text-[var(--text-muted)] hover:border-[rgba(184,133,110,0.28)] hover:text-[var(--accent-warm)]"
                                  }`}
                                  aria-label={isExcluded ? "Include in issue" : "Exclude from issue"}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                                {full?.url ? (
                                  <a
                                    href={urlOverrides[story.id] ?? full.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
                                    aria-label="Open source"
                                  >
                                    <ExternalLink className="h-3.5 w-3.5" />
                                  </a>
                                ) : null}
                                <button
                                  onClick={() => {
                                    setPreviewStoryId(story.id);
                                    setEditingPreviewId(story.id);
                                  }}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
                                  aria-label="Edit"
                                >
                                  <Pencil className="h-3.5 w-3.5" />
                                </button>
                                <button
                                  onClick={() => toggleExpand(story.id)}
                                  className="inline-flex h-6 w-6 items-center justify-center rounded text-[var(--text-muted)] hover:text-[var(--accent-primary)] transition"
                                  aria-label={isExpanded ? "Collapse" : "Expand"}
                                >
                                  {isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                                </button>
                              </div>
                            </div>

                            {/* Expanded panel */}
                            {isExpanded && (
                              <div className="border-t border-[var(--border-light)] bg-[var(--bg-warm)] px-4 py-3 space-y-3">
                                {hasHeadlineValidationError ? (
                                  <div className="rounded-lg border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-3 py-2 text-xs font-medium text-[var(--accent-warm)]">
                                    Re-select and include this story, or unset it as the newsletter headline.
                                  </div>
                                ) : null}

                                {story.summary ? (
                                  <p className="text-xs leading-5 text-[var(--text-secondary)]">{story.summary}</p>
                                ) : null}

                                <div className="flex flex-wrap items-center gap-3">
                                  <button
                                    onClick={() =>
                                      updateStoryStatus(
                                        story.id,
                                        section.key,
                                        status === "selected" ? "fill-in" : "selected"
                                      )
                                    }
                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                                      status === "selected"
                                        ? "border-[rgba(157,180,160,0.24)] bg-[rgba(235,242,237,0.9)] text-[var(--watercolor-sage)] hover:border-[var(--watercolor-sage)]"
                                        : "border-[rgba(107,155,184,0.24)] bg-[rgba(232,242,248,0.8)] text-[var(--watercolor-ink)] hover:border-[var(--accent-primary)]"
                                    }`}
                                  >
                                    {status === "selected" ? "Mark as fill-in" : "Select for issue"}
                                  </button>

                                  {/* Headline picker — only for Top Stories */}
                                  {section.key === "headlines" && (
                                  <button
                                    onClick={() => setHeadlineStoryId(isHeadline ? null : story.id)}
                                    className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition ${
                                      isHeadline
                                        ? "border-[var(--accent-primary)] bg-[rgba(107,155,184,0.12)] text-[var(--accent-primary)]"
                                        : "border-[var(--border-light)] bg-white text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                                    }`}
                                  >
                                    <Star className={`h-3 w-3 ${ isHeadline ? "fill-current" : ""}`} />
                                    {isHeadline ? "Headline story" : "Set as headline"}
                                  </button>
                                  )}

                                  {/* Exclude checkbox */}
                                  <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--text-secondary)] sm:hidden">
                                    <input
                                      type="checkbox"
                                      checked={isExcluded}
                                      onChange={() => toggleExclude(story.id)}
                                      className="h-3.5 w-3.5 rounded border-[var(--border)] accent-red-500"
                                    />
                                    Exclude from issue
                                  </label>
                                </div>

                                {/* Move to section — shown on all sizes, essential on mobile */}
                                {sections.filter((s) => s.key !== section.key).length > 0 && (
                                  <div className="flex flex-wrap items-center gap-1.5">
                                    <span className="text-[11px] text-[var(--text-muted)]">Move to:</span>
                                    {sections
                                      .filter((s) => s.key !== section.key)
                                      .map((target) => (
                                        <button
                                          key={target.key}
                                          onClick={() => moveStory(story.id, section.key, target.key)}
                                          className="rounded-full border border-[var(--border-light)] bg-white px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition"
                                        >
                                          {target.label}
                                        </button>
                                      ))}
                                  </div>
                                )}

                                {/* Reason input — only when excluded */}
                                {isExcluded && (
                                  <input
                                    type="text"
                                    placeholder="Reason for exclusion…"
                                    value={excl?.reason ?? ""}
                                    onChange={(e) => setExcludeReason(story.id, e.target.value)}
                                    className="w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-1.5 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                                  />
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="px-4 py-6 text-center text-sm text-[var(--text-secondary)]">
                        Drop stories here
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </main>
      </div>

      {/* Mobile commit bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-20 border-t border-[var(--border-light)] bg-[rgba(250,250,248,0.92)] px-4 py-3 backdrop-blur sm:hidden">
        <Button
          className="pointer-events-auto w-full bg-[var(--text-primary)] text-white hover:bg-[var(--watercolor-ink)] disabled:cursor-not-allowed disabled:opacity-50"
          onClick={handleCommitOutline}
          disabled={validationErrors.length > 0}
        >
          Commit
        </Button>
      </div>

      {commitModalOpen ? (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-[rgba(44,62,74,0.22)] p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
          <div className="w-full max-w-2xl overflow-hidden rounded-t-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] shadow-[0_30px_80px_rgba(61,79,95,0.22)] sm:rounded-[20px]">
            <div className="flex items-center justify-between border-b border-[var(--border-light)] px-5 py-4 sm:px-6">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
                  {validationErrors.length > 0 ? "Commit Blocked" : "Commit Summary"}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {validationErrors.length > 0
                    ? "Resolve these issues before continuing."
                    : "Everything looks ready. Review the outline summary before committing it to generation."}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setCommitModalOpen(false)}>Close</Button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
              {validationErrors.length > 0 ? (
                <div className="space-y-4">
                  <div className="rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3">
                    <div className="flex items-start gap-3">
                      <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-warm)]" />
                      <div className="space-y-2">
                        {validationErrors.map((error) => (
                          <p key={error} className="text-sm text-[var(--accent-warm)]">
                            {error}
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="space-y-4">
                  {commitResponseMessage ? (
                    <div className="rounded-xl border border-[rgba(107,155,184,0.24)] bg-[rgba(232,242,248,0.7)] px-4 py-3 text-sm text-[var(--watercolor-ink)]">
                      {commitResponseMessage}
                    </div>
                  ) : null}

                  {commitErrorMessage ? (
                    <div className="rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3 text-sm text-[var(--accent-warm)]">
                      {commitErrorMessage}
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-warm)] px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Headline</p>
                      <p className="mt-2 text-sm font-medium text-[var(--text-primary)]">{headlineStoryTitle}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-warm)] px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Selected</p>
                      <p className="mt-2 font-serif text-2xl text-[var(--text-primary)]">{totals.selectedCount}</p>
                    </div>
                    <div className="rounded-xl border border-[var(--border-light)] bg-[var(--bg-warm)] px-4 py-3">
                      <p className="text-[11px] uppercase tracking-[0.18em] text-[var(--text-muted)]">Sections</p>
                      <p className="mt-2 font-serif text-2xl text-[var(--text-primary)]">{totals.sections.length}</p>
                    </div>
                  </div>

                  <div className="space-y-2 rounded-xl border border-[var(--border-light)] bg-white px-4 py-4">
                    {totals.sections.map((section) => (
                      <div key={section.key} className="flex items-center justify-between gap-4 text-sm">
                        <span className="text-[var(--text-secondary)]">{section.label}</span>
                        <span className="font-medium text-[var(--text-primary)]">
                          {section.selectedCount} selected · {section.totalCount} visible
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex items-center justify-end gap-3 border-t border-[var(--border-light)] px-5 py-4 sm:px-6">
              <Button variant="outline" onClick={() => setCommitModalOpen(false)} disabled={isCommitting}>
                Cancel
              </Button>
              {validationErrors.length === 0 ? (
                <Button className="bg-[var(--text-primary)] text-white hover:bg-[var(--watercolor-ink)]" onClick={handleCommitContinue} disabled={isCommitting}>
                  {isCommitting ? "Committing..." : "Commit outline"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* Preview modal */}
      {previewStory ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-[rgba(44,62,74,0.18)] p-0 backdrop-blur-[2px] sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-hidden rounded-t-[20px] border border-[var(--border-light)] bg-[var(--bg-card)] shadow-[0_30px_80px_rgba(61,79,95,0.22)] sm:rounded-[20px]">
            <div className="flex items-center justify-between border-b border-[var(--border-light)] px-5 py-4">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
                  Story Preview
                </p>
                <p className="mt-0.5 text-sm text-[var(--text-secondary)]">
                  {previewStory.sectionLabel} · {previewStory.status === "selected" ? "Selected" : "Fill-in"}
                </p>
              </div>
              <Button variant="ghost" onClick={() => setPreviewStoryId(null)}>Close</Button>
            </div>
            <div className="max-h-[calc(92vh-72px)] overflow-y-auto px-5 py-6 sm:px-6">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-[rgba(232,242,248,0.7)] px-3 py-1 text-xs font-semibold text-[var(--watercolor-ink)]">
                  ID {previewStory.id}
                </span>
                {previewStory.day ? (
                  <span className="rounded-full bg-[var(--bg-warm)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                    {new Intl.DateTimeFormat("en-US", {
                      month: "short",
                      day: "numeric",
                      year: "numeric",
                      timeZone: "UTC",
                    }).format(
                      new Date(String(previewStory.day).slice(0, 10) + "T00:00:00Z")
                    )}
                  </span>
                ) : null}
                {previewStory.category ? (
                  <span className="rounded-full bg-[var(--bg-warm)] px-3 py-1 text-xs text-[var(--text-secondary)]">
                    {previewStory.category}
                  </span>
                ) : null}
              </div>
              <h3 className="mt-4 font-serif text-[clamp(22px,3.5vw,32px)] leading-[1.22] text-[var(--text-primary)]">
                {previewStory.headline || "Untitled story"}
              </h3>
              {previewStory.summary ? (
                <p className="mt-3 text-base leading-7 text-[var(--text-secondary)]">{previewStory.summary}</p>
              ) : null}
              {/* Editable link */}
              <div className="mt-5">
                <div className="flex items-center justify-between gap-3">
                  <label className="block text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">
                    Story Link
                  </label>
                  <button
                    onClick={() => setEditingPreviewId(editingPreviewId === previewStory.id ? null : previewStory.id)}
                    className="rounded-full border border-[var(--border-light)] px-2.5 py-1 text-[11px] font-medium text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition"
                  >
                    {editingPreviewId === previewStory.id ? "Done" : "Edit"}
                  </button>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  {editingPreviewId === previewStory.id ? (
                    <input
                      type="url"
                      value={urlOverrides[previewStory.id] ?? previewStory.url ?? ""}
                      onChange={(e) =>
                        setUrlOverrides((prev) => ({ ...prev, [previewStory.id]: e.target.value }))
                      }
                      placeholder="https://…"
                      className="min-w-0 flex-1 rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)]"
                    />
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--text-secondary)]">
                      {urlOverrides[previewStory.id] ?? previewStory.url ?? "No link"}
                    </span>
                  )}
                  {(urlOverrides[previewStory.id] ?? previewStory.url) ? (
                    <a
                      href={urlOverrides[previewStory.id] ?? previewStory.url ?? ""}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-[var(--border-light)] text-[var(--text-secondary)] hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)] transition"
                      aria-label="Open link"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  ) : null}
                </div>
              </div>

              <div className="mt-5 rounded-xl border border-[var(--border-light)] bg-[var(--bg-warm)] p-5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[var(--accent-primary)]">Notes</p>
                <textarea
                  value={notesOverrides[previewStory.id] ?? ""}
                  onChange={(e) =>
                    setNotesOverrides((prev) => ({ ...prev, [previewStory.id]: e.target.value }))
                  }
                  placeholder="Add notes…"
                  className="mt-3 w-full rounded-lg border border-[var(--border-light)] bg-white px-3 py-2 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:outline-none focus:ring-1 focus:ring-[var(--accent-primary)] resize-vertical"
                  rows={5}
                />
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
