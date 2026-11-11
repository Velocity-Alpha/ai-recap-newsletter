import { siteOf } from "@/src/pipeline/free-links/sites";
import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

/** The paywall state of each link the owner typed on this board, by story id (#59). */
export type LinkState = Record<number, PaywallStatus>;

/**
 * The paywall state of the link that is selected now: the owner's own link when there is one, otherwise the
 * stored state of the original link. The lock icon and the commit check both read it.
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
