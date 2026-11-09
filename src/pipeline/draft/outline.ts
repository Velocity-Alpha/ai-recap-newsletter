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

function storyId(value: unknown): number {
  const id = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  if (typeof id !== "number" || !Number.isInteger(id) || id <= 0) {
    throw new Error(`Commit payload has an invalid story id: ${JSON.stringify(value)}.`);
  }
  return id;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
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
  const stories = (Array.isArray(body.stories) ? body.stories : []).filter(isObject).map((story) => ({
    id: storyId(story.id),
    section: text(story.newsletter_category),
    url: typeof story.url === "string" ? story.url : null,
    note: text(story.note),
  }));
  const excluded = (Array.isArray(body.excluded_stories) ? body.excluded_stories : []).filter(isObject).map((story) => ({
    id: storyId(story.id),
    section: text(story.newsletter_category),
    reason: text(story.reason),
  }));

  return {
    date,
    sections,
    leadStoryId: lead === null || lead === undefined || lead === "" ? null : storyId(lead),
    stories,
    excluded,
  };
}

/** sha256 of the outline. The outline's keys are built in a fixed order, so equal outlines hash equally. */
export function hashOutline(outline: ApprovalOutline): string {
  return createHash("sha256").update(JSON.stringify(outline)).digest("hex");
}
