import { Prisma } from "@/src/generated/prisma";
import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";
import { prisma } from "@/src/server/prisma";

/**
 * /admin/feedback (#150): how much of the **proposed board** the owner kept, from the newest commit of each issue
 * date that has one, and the **reason codes** of the **board actions** of those commits.
 */

export const FEEDBACK_DAYS = 30;

type Sections = { key: string; storyIds: number[] }[];

export type FeedbackOutline = { id: bigint; issueDate: Date; proposed: unknown; payload: unknown };

export type FeedbackAction = { outlineId: bigint; action: string; reasonCode: string | null };

export type FeedbackDay = {
  date: string;
  proposed: number;
  /** Proposed, and approved in the same section. */
  keptInPlace: number;
  excluded: number;
  /** Added stories and restored repeats. */
  added: number;
  moved: number;
  leadChanged: boolean;
};

export type FeedbackSection = { key: string; label: string; proposed: number; keptInPlace: number; share: number };

export type FeedbackReason = { action: string; code: string; count: number };

export type FeedbackSummary = { days: FeedbackDay[]; sections: FeedbackSection[]; reasons: FeedbackReason[] };

/** The sections of a saved proposed board or outline (both are camelCase JSON), or null when it is not one. */
function sectionsOf(value: unknown): Sections | null {
  const sections = (value as { sections?: unknown } | null)?.sections;
  if (!Array.isArray(sections)) return null;
  return sections.flatMap((section) => {
    const { key, storyIds } = (section ?? {}) as { key?: unknown; storyIds?: unknown };
    if (typeof key !== "string" || !Array.isArray(storyIds)) return [];
    return [{ key, storyIds: storyIds.filter((id): id is number => Number.isInteger(id)) }];
  });
}

const LABELS = new Map<string, string>(CANDIDATE_SECTION_CONFIGS.map((section) => [section.key, section.label]));
const SECTION_ORDER = CANDIDATE_SECTION_CONFIGS.map((section) => section.key as string);

/** Outlines newest date first; one for each date. */
export function summarizeFeedback(outlines: FeedbackOutline[], actions: FeedbackAction[]): FeedbackSummary {
  const actionsByOutline = new Map<bigint, FeedbackAction[]>();
  for (const action of actions) {
    actionsByOutline.set(action.outlineId, [...(actionsByOutline.get(action.outlineId) ?? []), action]);
  }

  const days: FeedbackDay[] = [];
  const bySection = new Map<string, { proposed: number; keptInPlace: number }>();
  for (const outline of outlines) {
    const proposed = sectionsOf(outline.proposed);
    if (!proposed) continue;
    const approved = new Map((sectionsOf(outline.payload) ?? []).map((section) => [section.key, new Set(section.storyIds)]));

    let proposedCount = 0;
    let keptCount = 0;
    for (const section of proposed) {
      const kept = section.storyIds.filter((id) => approved.get(section.key)?.has(id)).length;
      proposedCount += section.storyIds.length;
      keptCount += kept;
      const totals = bySection.get(section.key) ?? { proposed: 0, keptInPlace: 0 };
      bySection.set(section.key, { proposed: totals.proposed + section.storyIds.length, keptInPlace: totals.keptInPlace + kept });
    }

    const own = actionsByOutline.get(outline.id) ?? [];
    const count = (...names: string[]) => own.filter((action) => names.includes(action.action)).length;
    days.push({
      date: outline.issueDate.toISOString().slice(0, 10),
      proposed: proposedCount,
      keptInPlace: keptCount,
      excluded: count("exclude"),
      added: count("add", "restore_repeat"),
      moved: count("move"),
      leadChanged: count("lead") > 0,
    });
  }

  const rank = (key: string) => (SECTION_ORDER.includes(key) ? SECTION_ORDER.indexOf(key) : SECTION_ORDER.length);
  const sections = [...bySection]
    .filter(([, totals]) => totals.proposed > 0)
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, totals]) => ({
      key,
      label: LABELS.get(key) ?? key,
      ...totals,
      share: Math.round((totals.keptInPlace / totals.proposed) * 100),
    }));

  const reasonCounts = new Map<string, FeedbackReason>();
  const counted = new Set(outlines.map((outline) => outline.id));
  for (const action of actions) {
    if (!action.reasonCode || !counted.has(action.outlineId)) continue;
    const id = `${action.action}\u0000${action.reasonCode}`;
    const entry = reasonCounts.get(id) ?? { action: action.action, code: action.reasonCode, count: 0 };
    reasonCounts.set(id, { ...entry, count: entry.count + 1 });
  }
  const reasons = [...reasonCounts.values()].sort(
    (a, b) => a.action.localeCompare(b.action) || b.count - a.count || a.code.localeCompare(b.code),
  );

  return { days, sections, reasons };
}

/** The newest outline with a proposed board for each of the last FEEDBACK_DAYS issue dates, summed up. */
export async function readFeedback(): Promise<FeedbackSummary> {
  const outlines = (
    await prisma.approvalOutline.findMany({
      where: { proposed: { not: Prisma.DbNull } },
      distinct: ["issueDate"],
      orderBy: [{ issueDate: "desc" }, { committedAt: "desc" }],
      select: { id: true, issueDate: true, proposed: true, payload: true },
    })
  ).slice(0, FEEDBACK_DAYS);
  if (outlines.length === 0) return { days: [], sections: [], reasons: [] };

  const actions = await prisma.boardAction.findMany({
    where: { outlineId: { in: outlines.map((outline) => outline.id) } },
    select: { outlineId: true, action: true, reasonCode: true },
  });
  return summarizeFeedback(outlines, actions);
}
