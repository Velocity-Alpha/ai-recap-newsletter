import type { Metric } from "@/evals/lib/results";
import { percentile } from "@/evals/lib/stats";
import { countHits, type Outcome } from "@/evals/lib/sweep";
import { mean } from "@/evals/scene-prompt/score";
import { siteOf } from "@/src/pipeline/free-links/sites";

/** Scoring of the web search for free links (src/pipeline/free-links/search.ts) and the repo's check of its links. */

/**
 * The web search tool's fee: $10.00 per 1,000 calls, plus its content tokens at the model's rates (they are in
 * the answer's input tokens). OpenAI pricing page, "Web search", read on 2026-11-10:
 * https://developers.openai.com/api/docs/pricing
 */
export const WEB_SEARCH_USD_PER_CALL = 0.01;

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

export interface FreeLinksOutput {
  /** Web search calls in the answer. */
  searches: number;
  /** False when the answer had no `links` list (the call site then gives no links). */
  answerParsed: boolean;
  links: CheckedFoundLink[];
  /** The time of the search call alone, without reads and the judge. */
  searchMs: number;
  /** The model's token cost of the search call (search content tokens included), without the per-call fee. */
  tokenUsd: number;
}

export interface FreeLinksItem {
  story: { id: number; url: string };
}

export const isUsable = (link: CheckedFoundLink) => link.kept && link.sameNews === "same";

export function storyCostUsd(output: FreeLinksOutput): number {
  return output.tokenUsd + output.searches * WEB_SEARCH_USD_PER_CALL;
}

export function scoreFreeLinks<I extends FreeLinksItem>(outcomes: Outcome<I, FreeLinksOutput>[]): Metric[] {
  const done = outcomes.flatMap((outcome) => (outcome.output ? [outcome.output] : []));
  const links = done.flatMap((output) => output.links);
  const readLinks = links.filter((link) => link.read);
  const owner = outcomes.filter((outcome) => OWNER_REPLACED_STORY_IDS.includes(outcome.item.story.id));
  const seconds = (ms: number | null) => (ms === null ? 0 : Math.round(ms / 100) / 10);
  const searchTimes = done.map((output) => output.searchMs);
  return [
    countHits("Stories with a usable link", outcomes, (outcome) => outcome.output.links.some(isUsable)),
    countHits("Stories with a kept link", outcomes, (outcome) => outcome.output.links.some((link) => link.kept)),
    { name: "Usable links", hits: links.filter(isUsable).length, n: links.length },
    { name: "Kept, judged not same news", hits: links.filter((link) => link.kept && link.sameNews !== null && link.sameNews !== "same").length, n: links.filter((link) => link.kept).length },
    { name: "Links that fail to read", hits: readLinks.filter((link) => link.readStatus !== "read").length, n: readLinks.length },
    { name: "Read but too short", hits: readLinks.filter((link) => link.readStatus === "read" && !link.kept).length, n: readLinks.length },
    { name: "Links on a paywall site", hits: links.filter((link) => link.onPaywallSite).length, n: links.length },
    countHits("Answer parsed", outcomes, (outcome) => outcome.output.answerParsed),
    countHits("Owner's replacement site found", owner, (outcome) =>
      outcome.output.links.some((link) => link.site === siteOf(outcome.item.story.url))
    ),
    { name: "Links per story", value: links.length / Math.max(1, outcomes.length) },
    { name: "Searches per story", value: mean(done.map((output) => output.searches)) },
    { name: "Cost per story ¢ (incl. search fee)", value: 100 * mean(done.map(storyCostUsd)) },
    { name: "Search p50 s", value: seconds(percentile(searchTimes, 50)) },
    { name: "Search p95 s", value: seconds(percentile(searchTimes, 95)) },
  ];
}
