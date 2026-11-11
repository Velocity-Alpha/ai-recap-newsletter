import type { Metric } from "@/evals/lib/results";
import { countHits, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import type { FoundLink } from "@/src/pipeline/free-links/search";
import { siteOf } from "@/src/pipeline/free-links/sites";

/**
 * Scoring of the web search for free links (src/pipeline/free-links/search.ts) and the repo's check of its links.
 * The web search fee and searches per call are in the standard columns (evals/lib/usage.ts).
 */

/** Stories whose current link is the one the owner chose by hand in the archive (fixture README). */
export const OWNER_REPLACED_STORY_IDS = [10844, 10916, 11042];

export type SameNews = "same" | "related" | "different";

/** One link the search returned, and what the check and the judge made of it. */
export interface CheckedFoundLink {
  url: string;
  site: string;
  /** On the paywall check's site lists (built in, or learned on the Neon dev branch). */
  onPaywallSite: boolean;
  /** Sent to the article reader. False when a site rule dropped it first (the story's own site, social, paywall). */
  read: boolean;
  /** The reader's status, or null when not read. */
  readStatus: string | null;
  words: number;
  /** Kept by `checkLinks`: read, and MIN_WORDS words or more. */
  kept: boolean;
  /** The judge's answer for a kept link; null when not kept or the judge failed. */
  sameNews: SameNews | null;
}

/** What the search gives: the run, timed. */
export interface FreeLinksOutput {
  /** False when the answer had no `links` list (the call site then gives no links). */
  answerParsed: boolean;
  found: FoundLink[];
}

/** What the check and the judge make of the found links: the grade step, not timed. */
export interface FreeLinksGrade {
  links: CheckedFoundLink[];
}

export interface FreeLinksItem {
  story: { id: number; url: string };
}

export const isUsable = (link: CheckedFoundLink) => link.kept && link.sameNews === "same";

type FreeLinksOutcome<I> = Outcome<I, FreeLinksOutput, FreeLinksGrade>;

/** A count over the stories that were checked: a failed search or check is a miss, a skipped repeat is left out. */
function storyHits<I>(name: string, outcomes: FreeLinksOutcome<I>[], test: (links: CheckedFoundLink[]) => boolean): Metric {
  const counted = outcomes.filter((outcome) => outcome.gradeStatus !== "skipped");
  return { name, hits: counted.filter((outcome) => outcome.grade !== null && test(outcome.grade.links)).length, n: counted.length };
}

export function scoreFreeLinks<I extends FreeLinksItem>(outcomes: FreeLinksOutcome<I>[]): Metric[] {
  const found = outcomes.flatMap((outcome) => outcome.output?.found ?? []);
  const links = gradedOutcomes(outcomes).flatMap((outcome) => outcome.grade.links);
  const readLinks = links.filter((link) => link.read);
  const kept = links.filter((link) => link.kept);
  const owner = outcomes.filter((outcome) => OWNER_REPLACED_STORY_IDS.includes(outcome.item.story.id));
  return [
    storyHits("Stories with a usable link", outcomes, (checked) => checked.some(isUsable)),
    storyHits("Stories with a kept link", outcomes, (checked) => checked.some((link) => link.kept)),
    { name: "Usable links", hits: links.filter(isUsable).length, n: links.length },
    { name: "Kept, judged not same news", hits: kept.filter((link) => link.sameNews !== null && link.sameNews !== "same").length, n: kept.length },
    { name: "Links that fail to read", hits: readLinks.filter((link) => link.readStatus !== "read").length, n: readLinks.length },
    { name: "Read but too short", hits: readLinks.filter((link) => link.readStatus === "read" && !link.kept).length, n: readLinks.length },
    { name: "Links on a paywall site", hits: links.filter((link) => link.onPaywallSite).length, n: links.length },
    countHits("Answer parsed", outcomes, (outcome) => outcome.output.answerParsed),
    countHits("Owner's replacement site found", owner, (outcome) =>
      outcome.output.found.some((link) => siteOf(link.url) === siteOf(outcome.item.story.url))
    ),
    { name: "Links per story", value: found.length / Math.max(1, outcomes.length) },
  ];
}
