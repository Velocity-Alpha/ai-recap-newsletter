"use client";

import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { hasBoardEdits } from "@/components/approval/board-edits";
import { repeatOfText, restoreRepeat, similarLabel, similarTooltip } from "@/components/approval/repeat-labels";
import { type LinkState, paywalledLinks, selectedLinkState, typedLinkOf } from "@/components/approval/story-links";
import type { AlsoFrom, RestorableRepeat } from "@/src/features/newsletter/board-repeats";
import type { SimilarStory } from "@/src/pipeline/repeats/repeat-rules";
import { storySources } from "@/src/features/newsletter/lead-story";
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
  AlertCircle,
  Lock,
  LockOpen,
  MinusCircle,
  Pencil,
  Sparkles,
  Star,
  Trash2,
  TriangleAlert,
  Zap,
} from "lucide-react";

import DateState from "@/components/approval/DateState";
import NoIssueTodayButton from "@/components/approval/NoIssueTodayButton";
import { Button } from "@/components/ui/button";
import { nativeCommitTarget, secondCommitNotice } from "@/features/newsletter/draft-links";
import { checkLink } from "@/features/newsletter/free-links-client";
import type { DateDraftsView } from "@/src/pipeline/draft/draft-board";

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
  /** Every newsletter that covered the story (#58). */
  sources?: string[];
  /** Duplicates the repeat check merged into this story. */
  also_from?: AlsoFrom[];
  /** Earlier stories this one looks like. The board shows the first as a label. */
  similar_to?: SimilarStory[];
  url: string | null;
  importance_score: number | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  keyword_score: number;
  combined_score: number;
};

type ReferenceStory = {
  id: number;
  usedInPublicationDate: string | null;
  heldForDate?: string | null;
  paywall_detected: "yes" | "no" | "unknown" | "error";
  error?: string | null;
  headline: string;
  summary: string;
};

type UnsentDraft = {
  date: string;
  story_count: number;
  reused: boolean;
};

type ApprovalBoardProps = {
  dateKey: string;
  unsentDrafts: UnsentDraft[];
  onToggleDraftReuse: (draftDate: string) => void;
  /** Called once the owner has changed anything on the board. */
  onEdit?: () => void;
  /** Extra notice shown at the bottom of the sticky header. */
  headerNotice?: ReactNode;
  outlineDateLabel: string;
  referenceStories: ReferenceStory[];
  candidateSections: CandidateSection[];
  candidateMap: Record<string, CandidateMapEntry>;
  /** The lead the board pre-sets (#58); the owner can change it. Null or absent: no lead is pre-set. */
  proposedLeadId?: number | null;
  /** The AI lead pick's one-line reason for the proposed lead. Null while the board shows the scored lead. */
  proposedLeadReason?: string | null;
  /** Candidates the repeat check removed. The owner can restore each one for this session. */
  repeatsRemoved?: RestorableRepeat<{ id: number; headline: string | null }>[];
  /** True when the repeat check did not finish for some candidates. */
  repeatCheckIncomplete?: boolean;
  /** Builds the board again, so the repeat check runs again. */
  onRebuild?: () => void;
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
  /** The date's state, current draft, and staged versions. Null if the read failed. */
  drafting?: DateDraftsView | null;
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

function formatShortDate(dateOnly: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(dateOnly + "T00:00:00Z"));
}

function describeUnsentDraft(draft: UnsentDraft): string {
  const stories = draft.story_count === 1 ? "story is" : "stories are";
  const issue = `The ${formatLongDate(draft.date)} issue was not sent.`;
  return draft.reused
    ? `${issue} Its ${draft.story_count} approved ${stories} back in the pool for this issue.`
    : `${issue} Its ${draft.story_count} approved ${stories} held for it and listed under Reference stories.`;
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

function renderPaywallIcon(paywallDetected: "yes" | "no" | "unknown" | "error" | null | undefined, errorMessage?: string | null) {
  if (paywallDetected === "yes") {
    return (
      <span title="Paywalled story" className="inline-flex shrink-0 cursor-default" aria-label="Paywalled story">
        <Lock className="h-3.5 w-3.5 text-red-500" />
      </span>
    );
  }
  if (paywallDetected === "no") {
    return (
      <span title="Free story" className="inline-flex shrink-0 cursor-default" aria-label="Free story">
        <LockOpen className="h-3.5 w-3.5 text-green-500" />
      </span>
    );
  }
  if (paywallDetected === "error") {
    const label = errorMessage ?? "Paywall detection error";
    return (
      <span title={label} className="inline-flex shrink-0 cursor-default" aria-label={label}>
        <AlertCircle className="h-3.5 w-3.5 text-orange-500" />
      </span>
    );
  }

  return (
    <span title="Unknown paywall status" className="inline-flex shrink-0 cursor-default" aria-label="Unknown paywall status">
      <MinusCircle className="h-3.5 w-3.5 text-gray-400" />
    </span>
  );
}

export default function ApprovalBoard({
  dateKey,
  unsentDrafts,
  onToggleDraftReuse,
  onEdit,
  headerNotice,
  outlineDateLabel,
  referenceStories,
  candidateSections,
  candidateMap,
  proposedLeadId = null,
  proposedLeadReason = null,
  repeatsRemoved = [],
  repeatCheckIncomplete = false,
  onRebuild,
  publishStatus,
  drafting = null,
}: ApprovalBoardProps) {
  const router = useRouter();
  const nextDraftNotice = secondCommitNotice(drafting);
  const [commitModalOpen, setCommitModalOpen] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitResponseMessage, setCommitResponseMessage] = useState<string | null>(null);
  const [commitErrorMessage, setCommitErrorMessage] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [previewStoryId, setPreviewStoryId] = useState<number | null>(null);
  const [sections, setSections] = useState<SectionState[]>(() => initSections(candidateSections));
  const [headlineStoryId, setHeadlineStoryId] = useState<number | null>(proposedLeadId);
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [excludeState, setExcludeState] = useState<Record<number, ExcludeState>>({});
  const [urlOverrides, setUrlOverrides] = useState<Record<number, string>>({});
  const [editingPreviewId, setEditingPreviewId] = useState<number | null>(null);
  const [notesOverrides, setNotesOverrides] = useState<Record<number, string>>({});
  const dragStory = useRef<{ storyId: number; fromSectionKey: string } | null>(null);
  const [dragOverSection, setDragOverSection] = useState<string | null>(null);
  const [restoredIds, setRestoredIds] = useState<Set<number>>(new Set());
  // The paywall state of each link the reviewer typed (#59). A story with no entry shows its stored state.
  const [linkState, setLinkState] = useState<LinkState>({});
  const [paywallWarningOpen, setPaywallWarningOpen] = useState(false);
  const latestUrlOverrides = useRef(urlOverrides);
  useEffect(() => {
    latestUrlOverrides.current = urlOverrides;
  }, [urlOverrides]);
  /** The typed link of each story that was sent to the paywall check, so leaving the field twice asks once. */
  const checkedLinks = useRef<Record<number, string>>({});

  useEffect(() => {
    setSections(initSections(candidateSections));
    setHeadlineStoryId(proposedLeadId);
    setRestoredIds(new Set());
  }, [candidateSections, proposedLeadId]);

  const shownRepeats = repeatsRemoved.filter((entry) => !restoredIds.has(entry.story.id));
  const restore = (entry: (typeof repeatsRemoved)[number]) => {
    const full = candidateMap[String(entry.story.id)];
    const option = { id: entry.story.id, headline: full?.headline ?? entry.story.headline ?? "", summary: full?.summary ?? "" };
    setSections((prev) => restoreRepeat(prev, option, entry.section));
    setRestoredIds((prev) => new Set(prev).add(entry.story.id));
  };

  const edited = hasBoardEdits({
    candidateSections,
    sections,
    headlineStoryId,
    proposedLeadId,
    excludeState,
    urlOverrides,
    notesOverrides,
  });
  useEffect(() => {
    if (edited) onEdit?.();
  }, [edited, onEdit]);

  const typeLink = (id: number, value: string) => {
    setUrlOverrides((prev) => ({ ...prev, [id]: value }));
    // The lock icon describes the selected link. This one is not checked until the reviewer leaves the field.
    setLinkState((prev) => ({ ...prev, [id]: "unknown" }));
    delete checkedLinks.current[id];
  };

  /** The reviewer left the link field or pressed "Done": check the typed link, or drop an edit that changed nothing. */
  const finishTypedLink = async (id: number) => {
    const value = latestUrlOverrides.current[id];
    if (value === undefined) return;
    const storyUrl = candidateMap[String(id)]?.url;
    const url = typedLinkOf(value, storyUrl);
    if (url === null) {
      const without = <T,>(map: Record<number, T>) => Object.fromEntries(Object.entries(map).filter(([key]) => Number(key) !== id));
      setUrlOverrides(without);
      setLinkState(without);
      return;
    }
    if (checkedLinks.current[id] === url) return;
    checkedLinks.current[id] = url;
    const state = await checkLink(url);
    const current = latestUrlOverrides.current[id];
    if (current !== undefined && typedLinkOf(current, storyUrl) === url) setLinkState((prev) => ({ ...prev, [id]: state }));
  };

  const closePreview = () => {
    if (previewStoryId !== null) void finishTypedLink(previewStoryId);
    setEditingPreviewId(null);
    setPreviewStoryId(null);
  };

  /** The lock icon of the link that is selected now. A stored fetch error describes the original link only. */
  const renderLinkIcon = (id: number) => {
    const candidate = candidateMap[String(id)];
    return renderPaywallIcon(
      selectedLinkState(id, linkState, candidate?.paywall_detected),
      id in linkState ? null : candidate?.error
    );
  };

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

  const paywalled = useMemo(
    () => paywalledLinks({ sections, excludeState, urlOverrides, linkState, candidateMap }),
    [candidateMap, excludeState, linkState, sections, urlOverrides]
  );

  const handleCommitOutline = () => {
    setCommitResponseMessage(null);
    setCommitErrorMessage(null);
    setPaywallWarningOpen(false);
    setCommitModalOpen(true);
  };

  const closeCommitModal = () => {
    setPaywallWarningOpen(false);
    setCommitModalOpen(false);
  };

  /** No issue goes out with a paywalled link unless the reviewer says so (#59). */
  const handleCommitContinue = async (options: { withPaywalledLinks?: boolean } = {}) => {
    if (paywalled.length > 0 && !options.withPaywalledLinks) {
      setPaywallWarningOpen(true);
      return;
    }
    setPaywallWarningOpen(false);
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

      // A native commit made a draft: follow it, also when its job did not start (the view offers "Retry").
      const draftTarget = nativeCommitTarget(commitResponseBody, dateKey);
      if (draftTarget) {
        setCommitModalOpen(false);
        router.push(draftTarget);
        return;
      }

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

          <div className="ml-auto flex shrink-0 items-center gap-2 pl-2">
            <NoIssueTodayButton dateKey={dateKey} />
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
        {unsentDrafts.map((draft) => (
          <div
            key={draft.date}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-[rgba(184,133,110,0.36)] bg-[rgba(255,244,236,0.85)] px-4 py-3 sm:px-6"
          >
            <p className="text-sm font-semibold text-[var(--accent-warm)]">{describeUnsentDraft(draft)}</p>
            <button
              type="button"
              onClick={() => onToggleDraftReuse(draft.date)}
              className="shrink-0 rounded-md border border-[rgba(184,133,110,0.5)] bg-white/80 px-3 py-1.5 text-xs font-medium text-[var(--accent-warm)] transition hover:bg-white"
            >
              {draft.reused ? `Hold them for ${formatShortDate(draft.date)}` : "Use them in this issue"}
            </button>
          </div>
        ))}
        {drafting ? <DateState date={dateKey} view={drafting} /> : null}
        {repeatCheckIncomplete ? (
          <p className="border-t border-[var(--border-light)] px-4 py-1.5 text-xs text-[var(--text-muted)] sm:px-6">
            The repeat check did not finish for some stories.
            {onRebuild ? (
              <button type="button" onClick={onRebuild} className="ml-2 underline hover:text-[var(--accent-primary)]">
                Check again
              </button>
            ) : null}
          </p>
        ) : null}
        {headerNotice}
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
                      // Held stories sort first: "held:" sorts after any date in descending order.
                      const key = story.heldForDate
                        ? `held:${story.heldForDate}`
                        : (story.usedInPublicationDate ?? "Unknown date");
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
                            : date.startsWith("held:")
                              ? `${formatShortDate(date.slice("held:".length))} · not sent yet`
                              : formatShortDate(date)}
                        </p>
                      </div>
                      <div className="divide-y divide-[var(--border-light)]">
                        {grouped[date].map((story) => (
                          <div key={story.id} className="flex items-start gap-3 px-5 py-3">
                            <div className="min-w-0">
                              <p className="flex items-center gap-1.5 text-sm font-medium leading-snug text-[var(--text-primary)] line-clamp-2">
                                {renderPaywallIcon(story.paywall_detected, story.error)}
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

          {shownRepeats.length > 0 ? (
            <details className="mb-8 rounded-xl border border-[var(--border-light)] bg-white">
              <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-[var(--text-secondary)]">
                Repeats removed ({shownRepeats.length})
              </summary>
              <ul className="divide-y divide-[var(--border-light)] border-t border-[var(--border-light)]">
                {shownRepeats.map((entry) => (
                  <li key={entry.story.id} className="flex items-center gap-3 px-4 py-2.5">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-[var(--text-primary)]">{entry.story.headline}</p>
                      <p className="truncate text-xs text-[var(--text-muted)]">{repeatOfText(entry.repeat_of)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => restore(entry)}
                      className="shrink-0 rounded-full border border-[var(--border-light)] bg-white px-2.5 py-0.5 text-[11px] text-[var(--text-secondary)] transition hover:border-[var(--accent-primary)] hover:text-[var(--accent-primary)]"
                    >
                      Restore
                    </button>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

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
                        const sourceCount = full ? storySources(full).length : 0;
                        const alsoFrom = full?.also_from ?? [];
                        const similar = full?.similar_to ?? [];

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
                                <Star
                                  className="h-3.5 w-3.5 shrink-0 fill-[var(--accent-primary)] text-[var(--accent-primary)]"
                                  aria-label={story.id === proposedLeadId ? "Proposed lead story" : "Lead story"}
                                />
                              )}

                              {/* Text */}
                              <div className="min-w-0 flex-1">
                                <p className={`flex items-center gap-1.5 truncate text-sm font-medium ${
                                  hasHeadlineValidationError
                                    ? "text-[var(--accent-warm)]"
                                    : isExcluded
                                    ? "line-through text-[var(--text-muted)]"
                                    : status === "fill-in"
                                    ? "text-[var(--text-secondary)]"
                                    : "text-[var(--text-primary)]"
                                }`}>
                                  {renderLinkIcon(story.id)}
                                  <span className="truncate">{story.headline}</span>
                                  {sourceCount > 1 || alsoFrom.length > 0 ? (
                                    <span
                                      title={[
                                        `Covered by ${storySources(full!).join(", ")}`,
                                        ...alsoFrom.map((entry) => `${entry.source ?? "Unknown source"}: ${entry.headline ?? ""}`),
                                      ].join("\n")}
                                      className="shrink-0 rounded-full border border-[rgba(107,155,184,0.24)] bg-[rgba(232,242,248,0.8)] px-1.5 text-[10px] font-medium text-[var(--watercolor-ink)]"
                                    >
                                      {sourceCount > 1 ? `${sourceCount} sources` : `${alsoFrom.length + 1} stories`}
                                    </span>
                                  ) : null}
                                  {similar.length > 0 ? (
                                    <span
                                      title={similarTooltip(similar)}
                                      className="max-w-[16rem] shrink truncate rounded-full border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-1.5 text-[10px] font-medium text-[var(--accent-warm)]"
                                    >
                                      {similarLabel(similar[0])}
                                    </span>
                                  ) : null}
                                </p>
                                {hasHeadlineValidationError ? (
                                  <p className="mt-1 truncate text-[11px] font-medium text-[var(--accent-warm)]">
                                    Headline story must stay selected and included.
                                  </p>
                                ) : isHeadline && story.id === proposedLeadId ? (
                                  <p className="mt-0.5 text-[11px] font-medium text-[var(--accent-primary)]">
                                    {proposedLeadReason ? `Proposed lead: ${proposedLeadReason} ` : "Proposed lead. "}
                                    Use &ldquo;Set as headline&rdquo; on another story to change it.
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

                                {alsoFrom.length > 0 ? (
                                  <ul className="space-y-1 text-xs text-[var(--text-secondary)]">
                                    {alsoFrom.map((entry) => (
                                      <li key={entry.id} className="flex items-center gap-1.5">
                                        {renderPaywallIcon(entry.paywall_detected)}
                                        <span className="shrink-0 text-[var(--text-muted)]">Also from {entry.source ?? "an unknown source"}:</span>
                                        {entry.url ? (
                                          <a href={entry.url} target="_blank" rel="noreferrer" className="truncate underline hover:text-[var(--accent-primary)]">
                                            {entry.headline ?? entry.url}
                                          </a>
                                        ) : (
                                          <span className="truncate">{entry.headline}</span>
                                        )}
                                      </li>
                                    ))}
                                  </ul>
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

                                  {/* Lead picker: any section, since a story several sources covered can lead from there (#58). */}
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
                  {validationErrors.length > 0 ? "Commit Blocked" : paywallWarningOpen ? "Paywalled Links" : "Commit Summary"}
                </p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">
                  {validationErrors.length > 0
                    ? "Resolve these issues before continuing."
                    : paywallWarningOpen
                    ? "These stories still have a paywalled link:"
                    : "Everything looks ready. Review the outline summary before committing it to generation."}
                </p>
              </div>
              <Button variant="ghost" onClick={closeCommitModal}>Close</Button>
            </div>

            <div className="max-h-[70vh] overflow-y-auto px-5 py-5 sm:px-6">
              {validationErrors.length === 0 && paywallWarningOpen ? (
                <ul className="space-y-2 rounded-xl border border-[rgba(184,133,110,0.28)] bg-[rgba(255,244,236,0.92)] px-4 py-3">
                  {paywalled.map((link) => (
                    <li key={link.id} className="flex items-start gap-2 text-sm text-[var(--text-primary)]">
                      <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-red-500" />
                      <span>
                        {link.headline} <span className="text-[var(--text-secondary)]">({link.site})</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : validationErrors.length > 0 ? (
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
                  {nextDraftNotice ? (
                    <div className="rounded-xl border border-[rgba(107,155,184,0.24)] bg-[rgba(232,242,248,0.7)] px-4 py-3 text-sm font-medium text-[var(--watercolor-ink)]">
                      {nextDraftNotice}
                    </div>
                  ) : null}

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
              <Button variant="outline" onClick={closeCommitModal} disabled={isCommitting}>
                {paywallWarningOpen ? "Go back" : "Cancel"}
              </Button>
              {validationErrors.length > 0 ? null : paywallWarningOpen ? (
                <Button
                  className="bg-[var(--text-primary)] text-white hover:bg-[var(--watercolor-ink)]"
                  onClick={() => handleCommitContinue({ withPaywalledLinks: true })}
                >
                  Commit anyway
                </Button>
              ) : (
                <Button className="bg-[var(--text-primary)] text-white hover:bg-[var(--watercolor-ink)]" onClick={() => handleCommitContinue()} disabled={isCommitting}>
                  {isCommitting ? "Committing..." : "Commit outline"}
                </Button>
              )}
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
              <Button variant="ghost" onClick={closePreview}>Close</Button>
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
                <span className="mr-2 inline-flex align-middle">
                  {renderLinkIcon(previewStory.id)}
                </span>
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
                    onClick={() => {
                      if (editingPreviewId !== previewStory.id) return setEditingPreviewId(previewStory.id);
                      void finishTypedLink(previewStory.id);
                      setEditingPreviewId(null);
                    }}
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
                      onChange={(e) => typeLink(previewStory.id, e.target.value)}
                      onBlur={() => void finishTypedLink(previewStory.id)}
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
