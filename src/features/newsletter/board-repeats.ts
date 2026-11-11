import { storySources } from "@/src/features/newsletter/lead-story";
import { shiftDay } from "@/src/pipeline/repeats/match-stories";
import { createRepeatCheck, type RepeatCheck } from "@/src/pipeline/repeats/repeat-check";
import {
  applyRepeatRules,
  type ExcludedStory,
  type ReferenceKind,
  type RepeatReference,
  type SimilarStory,
  type StoryMatchRow,
} from "@/src/pipeline/repeats/repeat-rules";
import { readRepeatWindowDays } from "@/src/pipeline/repeats/repeats-store";
import { logServerError, logServerInfo } from "@/src/server/observability";
import { prisma } from "@/src/server/prisma";

/**
 * The repeat check on the board (#90, ADR 0006): removes repeats, merges duplicates into one story, and labels
 * similar stories, from the story matches ingestion stored. Candidates that ingestion did not check are checked here.
 */

/** A duplicate merged into the story the board shows. #59 uses it to prefer a free link. */
export interface AlsoFrom {
  id: number;
  source: string | null;
  headline: string | null;
  url: string | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
}

export interface RepeatOf {
  id: number;
  headline: string;
  date: string;
  kind: ReferenceKind;
}

export interface BoardStory {
  id: number;
  source: string | null;
  sources?: string[];
  headline: string | null;
  url: string | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
  also_from?: AlsoFrom[];
  similar_to?: SimilarStory[];
}

/** A story in an unsent draft: a reference for this board. */
export interface HeldStory {
  id: number;
  headline: string | null;
  held_for_date?: string | null;
}

export interface BoardRepeats<T> {
  /** The candidates that stay, in rank order, with merged `sources`, `also_from` and `similar_to`. */
  heads: T[];
  repeatsRemoved: { story: T; repeat_of: RepeatOf }[];
  /** True when the check failed for some candidates: they may still hold repeats. */
  incomplete: boolean;
}

const fromDay = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);

async function checkUnchecked(ids: number[], check: RepeatCheck): Promise<boolean> {
  try {
    const result = await check(ids);
    if (result.pairs > 0 || result.failed) logServerInfo("approval.repeats.checked", { ...result });
    return !result.failed;
  } catch (error) {
    logServerError("approval.repeats.check_failed", error, { candidateCount: ids.length });
    return false;
  }
}

async function loadMatches(ids: number[]): Promise<StoryMatchRow[]> {
  if (ids.length === 0) return [];
  return prisma.storyMatch.findMany({
    where: { OR: [{ newerStoryId: { in: ids } }, { olderStoryId: { in: ids } }] },
    select: { newerStoryId: true, olderStoryId: true, similarity: true, same: true, news: true },
  });
}

function otherIds(matches: StoryMatchRow[], known: Set<number>): number[] {
  const ids = new Set<number>();
  for (const match of matches) {
    for (const id of [match.newerStoryId, match.olderStoryId]) if (!known.has(id)) ids.add(id);
  }
  return [...ids];
}

export async function applyBoardRepeats<T extends BoardStory>(
  input: { date: string; candidates: T[]; held: HeldStory[] },
  deps: { check?: RepeatCheck } = {},
): Promise<BoardRepeats<T>> {
  const { date, candidates, held } = input;
  if (candidates.length === 0) return { heads: [], repeatsRemoved: [], incomplete: false };
  const check = deps.check ?? createRepeatCheck({ apiKey: process.env.OPENAI_API_KEY ?? "" });
  const candidateIds = new Set(candidates.map((story) => story.id));

  const complete = await checkUnchecked([...candidateIds], check);

  // Every pair that touches a candidate, and every pair of the stories those pairs reach (for chain labels).
  const direct = await loadMatches([...candidateIds]);
  const reached = otherIds(direct, candidateIds);
  const second = await loadMatches(reached);
  const seen = new Set<string>();
  const matches = [...direct, ...second].filter((match) => {
    const key = `${match.newerStoryId}-${match.olderStoryId}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const windowStart = shiftDay(date, -(await readRepeatWindowDays()));
  const others = otherIds(matches, candidateIds);
  const rows = others.length
    ? await prisma.story.findMany({
        where: { id: { in: others } },
        select: { id: true, headline: true, usedInPublicationDate: true, excludeFromCandidates: true, excludedOn: true },
      })
    : [];

  const references = new Map<number, RepeatReference>();
  const excluded = new Map<number, ExcludedStory>();
  for (const row of rows) {
    const published = fromDay(row.usedInPublicationDate);
    if (published && published >= windowStart && published < date) {
      references.set(row.id, { headline: row.headline ?? "", date: published, kind: "published" });
    } else if (!published && row.excludeFromCandidates) {
      excluded.set(row.id, { headline: row.headline ?? "", excludedOn: fromDay(row.excludedOn) });
    }
  }
  for (const story of held) {
    if (story.held_for_date) references.set(story.id, { headline: story.headline ?? "", date: story.held_for_date, kind: "held" });
  }

  const result = applyRepeatRules({ candidates, matches, references, excluded });

  const membersByHead = new Map<number, T[]>();
  for (const { story, into } of result.merged) membersByHead.set(into, [...(membersByHead.get(into) ?? []), story]);
  const heads = result.heads.map((head) => {
    const members = membersByHead.get(head.id) ?? [];
    const similar = result.similarTo.get(head.id);
    if (members.length === 0 && !similar) return head;
    return {
      ...head,
      ...(members.length > 0
        ? {
            sources: storySources({ source: head.source, sources: [...storySources(head), ...members.flatMap((member) => storySources(member))] }),
            also_from: members.map((member) => ({
              id: member.id,
              source: member.source,
              headline: member.headline,
              url: member.url,
              paywall_detected: member.paywall_detected,
            })),
          }
        : {}),
      ...(similar ? { similar_to: similar } : {}),
    };
  });

  logServerInfo("approval.repeats.applied", {
    candidateCount: candidates.length,
    removedCount: result.removed.length,
    mergedCount: result.merged.length,
    labelledCount: result.similarTo.size,
    incomplete: !complete,
  });

  return {
    heads,
    repeatsRemoved: result.removed.map(({ story, repeatOf }) => ({ story, repeat_of: repeatOf })),
    incomplete: !complete,
  };
}
