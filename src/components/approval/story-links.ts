import type { FreeLinksByStory, StoryFreeLinks } from "@/src/features/newsletter/free-links-client";
import { siteOf } from "@/src/pipeline/free-links/sites";
import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

/** The paywall state of each link that was typed or selected on this board, by story id (#59). */
export type LinkState = Record<number, PaywallStatus>;

/**
 * The paywall state of the link that is selected now: the typed link or the selected free link when there is
 * one, otherwise the stored state of the original link. The lock icon and the commit check both read it.
 */
export function selectedLinkState(storyId: number, linkState: LinkState, stored: PaywallStatus | null | undefined): PaywallStatus {
  return linkState[storyId] ?? stored ?? "unknown";
}

/**
 * The link the owner typed, trimmed. Null when the field is empty or holds the story's own link again: the
 * story then has no link edit.
 */
export function typedLinkOf(value: string, storyUrl: string | null | undefined): string | null {
  const typed = value.trim();
  return typed && typed !== storyUrl ? typed : null;
}

export type PaywalledLink = { id: number; headline: string; site: string };

/** The stories of the outline (selected and not excluded) whose selected link is paywalled, in board order. */
export function paywalledLinks(board: {
  sections: { stories: { story: { id: number; headline: string }; status: "selected" | "fill-in" }[] }[];
  excludeState: Record<number, { excluded: boolean } | undefined>;
  urlOverrides: Record<number, string>;
  linkState: LinkState;
  candidateMap: Record<string, { url: string | null; paywall_detected?: PaywallStatus } | undefined>;
}): PaywalledLink[] {
  return board.sections
    .flatMap((section) => section.stories)
    .filter(({ story, status }) => status === "selected" && !board.excludeState[story.id]?.excluded)
    .flatMap(({ story }) => {
      const candidate = board.candidateMap[String(story.id)];
      if (selectedLinkState(story.id, board.linkState, candidate?.paywall_detected) !== "yes") return [];
      const url = board.urlOverrides[story.id] ?? candidate?.url ?? "";
      return [{ id: story.id, headline: story.headline, site: siteOf(url) ?? "unknown site" }];
    });
}

/** Which row of a story's link box is selected: the original link, one of the free links, or "Other link". */
export type LinkChoice = { kind: "original" } | { kind: "free"; index: number } | { kind: "other" };

/**
 * The selected row. `override` is the story's link edit, if any. `otherOpen` is true after the owner selected
 * "Other link", also while its field is still empty.
 */
export function linkChoiceOf(override: string | undefined, links: { url: string }[], otherOpen: boolean): LinkChoice {
  if (otherOpen) return { kind: "other" };
  if (override === undefined) return { kind: "original" };
  const index = links.findIndex((link) => link.url === override);
  return index === -1 ? { kind: "other" } : { kind: "free", index };
}

/**
 * The text of a card's free link pill. Null for a story with no search: its link is not paywalled.
 * `selectedUrl` is the link the story has on the board now, `originalUrl` the link it came with.
 */
export function freeLinkPill(freeLinks: StoryFreeLinks | undefined, selectedUrl: string | null, originalUrl: string | null): string | null {
  if (!freeLinks) return null;
  if (!freeLinks.done) return "finding free links…";
  if (freeLinks.links.length === 0) return "no free link found";
  const selected = freeLinks.links.find((link) => link.url === selectedUrl);
  if (!selected) return freeLinks.links.length === 1 ? "1 free link found" : `${freeLinks.links.length} free links found`;
  return `free link: ${selected.site}, ${selected.words} words · original: ${siteOf(originalUrl ?? "") ?? "unknown site"}`;
}

/**
 * The first free link of each story that just got its links, by story id, for the board to select. A story is
 * left out when the owner already changed its link, or when the board selected a link for it before.
 */
export function linksToAutoSelect(update: FreeLinksByStory, ownerChanged: ReadonlySet<number>, selectedBefore: Record<number, string>): Record<number, string> {
  return Object.fromEntries(
    Object.entries(update).flatMap(([key, story]) => {
      const id = Number(key);
      const first = story.done ? story.links[0] : undefined;
      return first && !ownerChanged.has(id) && !(id in selectedBefore) ? [[id, first.url]] : [];
    }),
  );
}

/**
 * The link edits the owner made: the edits without the free links the board selected by itself. Only these count
 * as board edits, so a free link the board selected does not stop the AI lead pick.
 */
export function ownerLinkEdits(urlOverrides: Record<number, string>, autoLinks: Record<number, string>): Record<number, string> {
  return Object.fromEntries(Object.entries(urlOverrides).filter(([id, url]) => autoLinks[Number(id)] !== url));
}
