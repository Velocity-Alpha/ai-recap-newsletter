import { outlineStoryIds } from "@/src/pipeline/draft/approved-stories";
import type { ApprovalOutline, BoardFeedback, ProposedBoard } from "@/src/pipeline/draft/outline";

/**
 * How a commit changed the **proposed board** (#150): one **board action** for each difference between what the
 * board proposed and the committed outline. Pure: the commit reads the inputs and saves the rows.
 *
 * A story gives at most one of `exclude`, `add`, `restore_repeat`, `move`; `lead` and `link` rows are extra.
 * Positions count from 1.
 */

export const BOARD_ACTIONS = ["exclude", "add", "restore_repeat", "move", "reorder", "lead", "link"] as const;
export type BoardActionKind = (typeof BOARD_ACTIONS)[number];

export type BoardActionDetail =
  | { before: number[]; after: number[] }
  | { from: number | null }
  | { from: string | null; to: string };

export interface BoardActionRow {
  /** Null for `reorder`, and for `lead` when the owner cleared the lead. */
  storyId: number | null;
  action: BoardActionKind;
  fromSection: string | null;
  toSection: string | null;
  fromPosition: number | null;
  toPosition: number | null;
  reasonCode: string | null;
  reasonText: string | null;
  detail: BoardActionDetail | null;
}

export const MAX_REASON_CODE = 40;
export const MAX_REASON_TEXT = 500;

export interface BoardDiffInput {
  /** Null for a commit from a board that sent no proposed board: only `link` rows are possible then. */
  proposed: ProposedBoard | null;
  outline: ApprovalOutline;
  /** The link of each story in the database before this commit. A story that is missing has no link. */
  storedUrls: ReadonlyMap<number, string | null>;
  feedback: BoardFeedback[];
}

type Place = { section: string; position: number };

function places(sections: { key: string; storyIds: number[] }[]): Map<number, Place> {
  const map = new Map<number, Place>();
  for (const section of sections) {
    section.storyIds.forEach((id, index) => {
      if (!map.has(id)) map.set(id, { section: section.key, position: index + 1 });
    });
  }
  return map;
}

function trimmed(value: string | undefined, max: number): string | null {
  const text = (value ?? "").trim().slice(0, max);
  return text === "" ? null : text;
}

function reason(code: string | undefined, text: string | undefined) {
  return { reasonCode: trimmed(code, MAX_REASON_CODE), reasonText: trimmed(text, MAX_REASON_TEXT) };
}

function emptyRow(action: BoardActionKind, storyId: number | null): BoardActionRow {
  return {
    storyId,
    action,
    fromSection: null,
    toSection: null,
    fromPosition: null,
    toPosition: null,
    reasonCode: null,
    reasonText: null,
    detail: null,
  };
}

function linkRows(outline: ApprovalOutline, storedUrls: ReadonlyMap<number, string | null>): BoardActionRow[] {
  const approved = new Set(outlineStoryIds(outline));
  const seen = new Set<number>();
  return outline.stories.flatMap((story) => {
    if (!approved.has(story.id) || seen.has(story.id)) return [];
    seen.add(story.id);
    const to = story.url?.trim() ?? "";
    const from = storedUrls.get(story.id) ?? null;
    if (to === "" || to === from) return [];
    return [{ ...emptyRow("link", story.id), detail: { from, to } }];
  });
}

function storyRows(proposed: ProposedBoard, outline: ApprovalOutline, feedback: BoardFeedback[]): BoardActionRow[] {
  const before = places(proposed.sections);
  const after = places(outline.sections);
  const repeats = new Set(proposed.repeatsRemoved);
  const rows: BoardActionRow[] = [];

  for (const [id, from] of before) {
    const to = after.get(id);
    if (!to) {
      const excluded = outline.excluded.find((story) => story.id === id);
      rows.push({
        ...emptyRow("exclude", id),
        fromSection: from.section,
        fromPosition: from.position,
        ...reason(excluded?.reasonCode, excluded?.reason),
      });
    } else if (to.section !== from.section) {
      const given = feedback.find((entry) => entry.action === "move" && entry.storyId === id);
      rows.push({
        ...emptyRow("move", id),
        fromSection: from.section,
        fromPosition: from.position,
        toSection: to.section,
        toPosition: to.position,
        ...reason(given?.code, given?.text),
      });
    }
  }

  for (const [id, to] of after) {
    if (before.has(id)) continue;
    rows.push({
      ...emptyRow(repeats.has(id) ? "restore_repeat" : "add", id),
      toSection: to.section,
      toPosition: to.position,
    });
  }

  // Only the stories that stayed in the section count: an exclude, an add, or a move is not a reorder.
  for (const section of outline.sections) {
    const stayed = (id: number) => before.get(id)?.section === section.key && after.get(id)?.section === section.key;
    const proposedIds = proposed.sections.find((entry) => entry.key === section.key)?.storyIds ?? [];
    const orderBefore = proposedIds.filter(stayed);
    const orderAfter = section.storyIds.filter(stayed);
    if (orderBefore.join(",") !== orderAfter.join(",")) {
      rows.push({ ...emptyRow("reorder", null), toSection: section.key, detail: { before: orderBefore, after: orderAfter } });
    }
  }

  if (outline.leadStoryId !== proposed.leadStoryId) {
    const given = feedback.find((entry) => entry.action === "lead" && entry.storyId === outline.leadStoryId);
    rows.push({
      ...emptyRow("lead", outline.leadStoryId),
      ...reason(given?.code, given?.text),
      detail: { from: proposed.leadStoryId },
    });
  }

  return rows;
}

export function diffBoard({ proposed, outline, storedUrls, feedback }: BoardDiffInput): BoardActionRow[] {
  return [...(proposed ? storyRows(proposed, outline, feedback) : []), ...linkRows(outline, storedUrls)];
}
