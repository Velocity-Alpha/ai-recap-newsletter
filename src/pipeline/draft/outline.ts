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
  excluded: { id: number; section: string; reason: string }[];
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
    return [{ id, section: text(story.newsletter_category), reason: text(story.reason) }];
  });

  return {
    date,
    sections,
    leadStoryId: lead === null || lead === undefined || lead === "" ? null : storyId(lead),
    stories,
    excluded,
  };
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
