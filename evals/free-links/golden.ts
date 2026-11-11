import { join } from "node:path";

import type { FreeLinksGolden } from "@/evals/free-links/score";
import { goldenInput, type PaywalledStory } from "@/evals/free-links/stories";
import { SAME_NEWS_INSTRUCTIONS } from "@/evals/free-links/rubric";
import { hashInput, type Golden } from "@/evals/lib/golden";
import { FREE_ARTICLES_ASK, FREE_LINK_EXCLUSIONS, FREE_LINK_PREFERENCE } from "@/src/pipeline/free-links/search";
import { MAX_LINKS, MIN_WORDS, SKIPPED_SITES, siteOf } from "@/src/pipeline/free-links/sites";
import { checkSiteList, isOnSiteList } from "@/src/pipeline/ingest/paywall";

/**
 * The golden values of the free-links eval: for each story, whether a free link exists and up to MAX_LINKS free,
 * same-news articles Claude Opus found and read (golden-todo.md). Story ids and public URLs only, so the file is
 * committed. The rules a golden agent follows are built here from the app's own words (search.ts, sites.ts, the
 * judge's rubric), never retyped.
 */

export const GOLDEN_PATH = join("evals", "free-links", "golden.json");
export const GOLDEN_INPUTS_DIR = join("evals", "data", "free-links", "golden-inputs");

/** The judge's three answers, as its rubric gives them: the line of each, from SAME_NEWS_INSTRUCTIONS. */
export function sameNewsDefinitions(): string[] {
  return SAME_NEWS_INSTRUCTIONS.split("\n").filter((line) => line.startsWith("Answer \""));
}

/** The rules file a golden agent reads first (golden-inputs/_rules.md). */
export function goldenRules(learnedSites: readonly string[]): string {
  return [
    "# Rules for a free-links golden value",
    "",
    "Built by evals/free-links/golden-inputs.ts from the app's own words. Do not change them here.",
    "",
    "## The ask, as the app's web search gets it (src/pipeline/free-links/search.ts)",
    "",
    `- Search the web and ${FREE_ARTICLES_ASK}.`,
    `- ${FREE_LINK_PREFERENCE}`,
    `- ${FREE_LINK_EXCLUSIONS}`,
    "",
    "## What the eval's judge calls the same news (evals/free-links/rubric.ts)",
    "",
    ...sameNewsDefinitions().map((line) => `- ${line}`),
    "",
    "Only a \"same\" article can be a golden URL.",
    "",
    "## The app's check of a link (src/pipeline/free-links/check-links.ts, sites.ts, ingest/paywall.ts)",
    "",
    `- At most ${MAX_LINKS} links.`,
    `- The article is free to read (no login, no subscribe wall) and has ${MIN_WORDS} words or more of article text.`,
    "- Not on the story's own site (the site of its `url`).",
    `- Not on a skipped site, or one of its subdomains: ${SKIPPED_SITES.join(", ")}.`,
    "- Not on a paywalled site: the `PAYWALLED` list in src/pipeline/ingest/paywall.ts, or a learned paywalled site.",
    `- Learned paywalled sites on the Neon dev branch when these inputs were written: ${learnedSites.length ? learnedSites.join(", ") : "none"}.`,
    "",
  ].join("\n");
}

/** One story's golden input file. */
export interface GoldenInputFile {
  itemId: string;
  /** hashInput(input): copy it to the entry's `inputHash`. */
  inputHash: string;
  input: ReturnType<typeof goldenInput>;
}

export function goldenInputFile(story: PaywalledStory): GoldenInputFile {
  const input = goldenInput(story);
  return { itemId: String(story.id), inputHash: hashInput(input), input };
}

/**
 * What is wrong with the golden entries of these stories: a stale hash, a value of the wrong shape, or a URL the
 * app's check would drop before reading it (the built-in site lists only; learned sites need the database).
 */
export function goldenProblems(golden: Golden<FreeLinksGolden>, stories: PaywalledStory[]): string[] {
  const problems: string[] = [];
  const byId = new Map(stories.map((story) => [String(story.id), story]));
  for (const [id, entry] of Object.entries(golden.entries)) {
    const story = byId.get(id);
    if (!story) {
      problems.push(`${id}: not a story of the test set`);
      continue;
    }
    if (entry.inputHash !== hashInput(goldenInput(story))) problems.push(`${id}: inputHash is not that of its golden input`);
    const value = entry.value;
    if (typeof value?.free_source_exists !== "boolean" || !Array.isArray(value.urls)) {
      problems.push(`${id}: value needs free_source_exists (boolean) and urls (list)`);
      continue;
    }
    if (value.free_source_exists !== value.urls.length > 0) problems.push(`${id}: free_source_exists must be true exactly when urls is not empty`);
    if (value.urls.length > MAX_LINKS) problems.push(`${id}: more than ${MAX_LINKS} urls`);
    for (const url of value.urls) {
      const site = siteOf(url);
      if (!site) problems.push(`${id}: ${url} is not an http(s) link`);
      else if (site === siteOf(story.url)) problems.push(`${id}: ${url} is on the story's own site`);
      else if (isOnSiteList(site, SKIPPED_SITES)) problems.push(`${id}: ${url} is on a skipped site`);
      else if (checkSiteList(url) === "yes") problems.push(`${id}: ${url} is on a paywalled site`);
    }
  }
  return problems;
}
