import { createHash } from "node:crypto";

/**
 * The committed **outline** (GLOSSARY.md): what the owner approved on the board, without the rest of the
 * client's body. Saved on every commit (#75); native drafting (#76) writes from it.
 */
export interface ApprovalOutline {
  date: string;
  /** Approved story ids per section, in board order. */
  sections: { key: string; storyIds: number[] }[];
  leadStoryId: number | null;
  /** Every visible story with its final link and note (board edits included). */
  stories: { id: number; section: string; url: string | null; note: string }[];
  /** `reasonCode` is the reason chip the owner tapped, or "". `reason` is the free text. */
  excluded: { id: number; section: string; reason: string; reasonCode: string }[];
}

/**
 * The **proposed board** (GLOSSARY.md, #150): what the board showed before the owner's first change. Saved next
 * to the outline (`approval_outlines.proposed`), so each commit's board actions can be worked out.
 */
export interface ProposedBoard {
  /** The selected story ids of each section, in board order. */
  sections: { key: string; storyIds: number[] }[];
  leadStoryId: number | null;
  /** The ids of the candidates the repeat check removed ("Repeats removed" on the board). */
  repeatsRemoved: number[];
}

/** An optional reason the owner gave on the board for a lead change or a move (#150). */
export interface BoardFeedback {
  /** The new lead, or the moved story. Null for a lead the owner cleared. */
  storyId: number | null;
  action: "lead" | "move";
  code: string;
  text: string;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseStoryId(value: unknown): number | null {
  const id = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** For approved and lead ids: a bad one rejects the commit. */
function storyId(value: unknown): number {
  const id = parseStoryId(value);
  if (id === null) throw new Error(`Commit payload has an invalid story id: ${JSON.stringify(value)}.`);
  return id;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function listOf(value: unknown): Json[] {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function sectionOrder(body: Json, approved: Json): string[] {
  const fromBoard = Array.isArray(body.candidate_sections)
    ? body.candidate_sections.flatMap((section) => (isObject(section) && typeof section.key === "string" ? [section.key] : []))
    : [];
  const keys = Object.keys(approved);
  return [...fromBoard.filter((key) => keys.includes(key)), ...keys.filter((key) => !fromBoard.includes(key))];
}

/** Throws with a plain message when the body has no usable approved stories. */
export function normalizeOutline(body: Json, date: string): ApprovalOutline {
  const approved = body.approved_ids_by_section;
  if (!isObject(approved)) throw new Error("Commit payload is missing the approved stories.");

  const sections = sectionOrder(body, approved).map((key) => {
    const ids = approved[key];
    return { key, storyIds: Array.isArray(ids) ? ids.map(storyId) : [] };
  });
  if (sections.every((section) => section.storyIds.length === 0)) {
    throw new Error("Commit payload has no approved stories.");
  }

  const lead = body.newsletter_headline;
  // `stories` and `excluded_stories` are informational, so an entry with a bad id is skipped, not rejected.
  const stories = listOf(body.stories).flatMap((story) => {
    const id = parseStoryId(story.id);
    if (id === null) return [];
    const url = typeof story.url === "string" ? story.url : null;
    return [{ id, section: text(story.newsletter_category), url, note: text(story.note) }];
  });
  const excluded = listOf(body.excluded_stories).flatMap((story) => {
    const id = parseStoryId(story.id);
    if (id === null) return [];
    return [{ id, section: text(story.newsletter_category), reason: text(story.reason), reasonCode: text(story.reason_code) }];
  });

  return {
    date,
    sections,
    leadStoryId: lead === null || lead === undefined || lead === "" ? null : storyId(lead),
    stories,
    excluded,
  };
}

function storyIds(value: unknown): number[] {
  return Array.isArray(value) ? value.flatMap((id) => parseStoryId(id) ?? []) : [];
}

/**
 * The `proposed` field of a commit body. Lenient, like the informational lists: a bad entry is skipped, a missing
 * field gives null or an empty list, and it never throws. Null when the body has no proposed board.
 */
export function normalizeProposed(body: Json): ProposedBoard | null {
  const proposed = body.proposed;
  if (!isObject(proposed)) return null;
  return {
    sections: listOf(proposed.sections).flatMap((section) =>
      typeof section.key === "string" ? [{ key: section.key, storyIds: storyIds(section.story_ids) }] : [],
    ),
    leadStoryId: parseStoryId(proposed.lead_story_id),
    repeatsRemoved: storyIds(proposed.repeats_removed),
  };
}

/** The `feedback` field of a commit body: the reasons for a lead change or a move. Lenient; never throws. */
export function normalizeFeedback(body: Json): BoardFeedback[] {
  return listOf(body.feedback).flatMap((entry) => {
    const action = entry.action;
    if (action !== "lead" && action !== "move") return [];
    const id = parseStoryId(entry.story_id);
    const noId = entry.story_id === null || entry.story_id === undefined;
    // A move always names its story. A lead names the new lead, or none when the owner cleared it.
    if (id === null && (action === "move" || !noId)) return [];
    return [{ storyId: id, action, code: text(entry.code), text: text(entry.text) }];
  });
}

/**
 * The lead story id of a saved outline payload (`approval_outlines.payload`): null when the outline has no lead
 * story, undefined when the payload does not say (no payload, no key, or a value that is not a story id).
 */
export function outlineLeadStoryId(payload: unknown): number | null | undefined {
  if (!isObject(payload)) return undefined;
  const lead = payload.leadStoryId;
  if (lead === null) return null;
  return typeof lead === "number" ? (parseStoryId(lead) ?? undefined) : undefined;
}

/** A copy with every object's keys sorted, at any depth. Array order is kept. */
function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (isObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortKeys(value[key])]),
    );
  }
  return value;
}

/**
 * sha256 of the outline in canonical form (keys sorted at every depth). jsonb does not keep key order, so
 * re-hashing a saved payload gives the same hash.
 */
export function hashOutline(outline: ApprovalOutline): string {
  return createHash("sha256").update(JSON.stringify(sortKeys(outline))).digest("hex");
}

/** `YYYY-MM-DD`, optionally followed by a time. Returns the calendar date as written, or null. */
export function parseCommitDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}
