import type { RepeatOf } from "@/src/features/newsletter/board-repeats";
import type { SimilarStory } from "@/src/pipeline/repeats/repeat-rules";

/** The board's text for the repeat check (#90): removed repeats and similar-story labels. */

/** "6 Nov" for "2026-11-06". */
function dayMonth(day: string): string {
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(
    new Date(`${day}T00:00:00Z`)
  );
}

/** Why a removed repeat is off the board. */
export function repeatOfText(repeatOf: RepeatOf): string {
  const when = repeatOf.kind === "held" ? `in the unsent draft for ${dayMonth(repeatOf.date)}` : dayMonth(repeatOf.date);
  return `repeat of "${repeatOf.headline}", ${when}`;
}

/** The label on a candidate that looks like an earlier story. */
export function similarLabel(similar: SimilarStory): string {
  if (similar.kind === "excluded") {
    return similar.date ? `like a story you excluded on ${dayMonth(similar.date)}` : "like a story you excluded earlier";
  }
  return `similar: "${similar.headline}", ${dayMonth(similar.date)}`;
}

/** Every similar story, one per line. Excluded stories add their headline, which the label leaves out. */
export function similarTooltip(similar: SimilarStory[]): string {
  return similar
    .map((entry) => (entry.kind === "excluded" ? `${similarLabel(entry)}: "${entry.headline}"` : similarLabel(entry)))
    .join("\n");
}

type Slot<S> = { story: S; status: "selected" | "fill-in" };

/** Puts a removed repeat back in its section as a fill-in. The board keeps it for this session only. */
export function restoreRepeat<S extends { id: number }, T extends { key: string; stories: Slot<S>[] }>(
  sections: T[],
  story: S,
  sectionKey: string
): T[] {
  if (sections.some((section) => section.stories.some((slot) => slot.story.id === story.id))) return sections;
  return sections.map((section) =>
    section.key === sectionKey ? { ...section, stories: [...section.stories, { story, status: "fill-in" as const }] } : section
  );
}
