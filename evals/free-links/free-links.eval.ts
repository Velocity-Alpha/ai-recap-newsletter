// The web search for free links (src/pipeline/free-links/search.ts) on the 10 stories of its test set, with the
// repo's own check of each link (check-links.ts: site rules, then the article reader). evals/README.md.
// It replaces the old opt-in live test, and writes nothing: no free links are saved and no paywalled site is recorded.
import { expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type RunContext } from "@/evals/lib/sweep";
import { costUsd, priceOf, usageFrom } from "@/evals/lib/usage";
import { sameNewsInput, SAME_NEWS_INSTRUCTIONS, SAME_NEWS_SCHEMA } from "@/evals/free-links/rubric";
import {
  OWNER_REPLACED_STORY_IDS,
  scoreFreeLinks,
  storyCostUsd,
  WEB_SEARCH_USD_PER_CALL,
  type CheckedFoundLink,
  type FreeLinksOutput,
  type SameNews,
} from "@/evals/free-links/score";
import { readerOptionsFromEnv } from "@/src/pipeline/draft/articles/draft-reader";
import { readArticles } from "@/src/pipeline/draft/articles/read-articles";
import answers from "@/src/pipeline/free-links/__fixtures__/search-answers.json";
import { checkLinks, READ_DEADLINE_MS, type LinkRead } from "@/src/pipeline/free-links/check-links";
import { isLearned } from "@/src/pipeline/free-links/paywall-sites";
import { parseSearchAnswer, SEARCH_MODEL, searchFreeLinks, type SearchClient } from "@/src/pipeline/free-links/search";
import { MIN_WORDS, siteOf } from "@/src/pipeline/free-links/sites";
import { checkSiteList } from "@/src/pipeline/ingest/paywall";

type Item = (typeof answers)[number];

/** The learned paywalled sites on the Neon dev branch (read-only), as the job would use them. */
async function loadLearnedSites(): Promise<{ sites: string[]; source: string }> {
  const rows = await readOnlyQuery<{ site: string; story_ids: number[]; ignored: boolean }>(
    "SELECT site, story_ids, ignored FROM newsletter.paywall_sites"
  );
  if (rows === null) return { sites: [], source: "none (DATABASE_URL not set)" };
  const sites = rows.filter((row) => isLearned({ storyIds: row.story_ids, ignored: row.ignored })).map((row) => row.site);
  return { sites, source: `${sites.length} from the Neon dev branch` };
}

/**
 * Each link is read once for the whole sweep, so every effort is checked against the same reads. The reader is
 * the repo's, with the step's deadline, one link at a time.
 */
const reads = new Map<string, Promise<LinkRead>>();
function readOnce(url: string): Promise<LinkRead> {
  let read = reads.get(url);
  if (!read) {
    read = readArticles([{ id: 0, url }], { deadlineMs: READ_DEADLINE_MS, ...readerOptionsFromEnv(process.env) }).then(
      ({ reads: [result] }) => ({ url, status: result.status, text: result.text })
    );
    reads.set(url, read);
  }
  return read;
}

/** One verdict per (story, link) for the whole sweep: its cost goes to the first config that found the link. */
const verdicts = new Map<string, Promise<SameNews | null>>();

function makeRun(learnedSites: string[]) {
  return async function run(item: Item, context: RunContext): Promise<FreeLinksOutput> {
    let searches = 0;
    let tokenUsd = 0;
    let rawText = "";
    const price = priceOf(context.config.model);
    const client: SearchClient = {
      responses: {
        async create(request, options) {
          const response = await context.client.responses.create(request as never, options as never);
          searches += (response.output ?? []).filter((entry) => entry.type === "web_search_call").length;
          const usage = usageFrom(response.usage);
          if (usage && price) tokenUsd += costUsd(usage, price);
          rawText = response.output_text ?? "";
          return response;
        },
      },
    };

    const story = { id: item.story.id, headline: item.story.headline, summary: item.story.summary, url: item.story.url };
    const started = performance.now();
    const found = await searchFreeLinks(story, { client, model: context.config.model, effort: context.config.effort, log: () => undefined });
    const searchMs = performance.now() - started;

    const sentToRead = new Set<string>();
    const kept = await checkLinks(story, found, {
      learnedSites,
      read: async (urls) => {
        urls.forEach((url) => sentToRead.add(url));
        return Promise.all(urls.map(readOnce));
      },
      recordPaywalledSite: async () => undefined,
    });
    const keptUrls = new Set(kept.map((link) => link.url));

    const links: CheckedFoundLink[] = await Promise.all(
      found.map(async (link): Promise<CheckedFoundLink> => {
        const read = sentToRead.has(link.url) ? await readOnce(link.url) : null;
        const isKept = keptUrls.has(link.url);
        let sameNews: SameNews | null = null;
        if (isKept && read?.text) {
          const key = `${story.id}|${link.url}`;
          if (!verdicts.has(key)) {
            verdicts.set(
              key,
              context
                .judge<{ same_news: SameNews }>({
                  name: "same_news",
                  instructions: SAME_NEWS_INSTRUCTIONS,
                  input: sameNewsInput(item.story, link, read.text),
                  schema: SAME_NEWS_SCHEMA,
                })
                .then((answer) => answer.same_news)
                .catch(() => null)
            );
          }
          sameNews = await verdicts.get(key)!;
        }
        return {
          url: link.url,
          site: siteOf(link.url) ?? "",
          onPaywallSite: checkSiteList(link.url, learnedSites) === "yes",
          read: read !== null,
          readStatus: read?.status ?? null,
          words: kept.find((entry) => entry.url === link.url)?.words ?? (read?.text ? read.text.trim().split(/\s+/).length : 0),
          kept: isKept,
          sameNews,
        };
      })
    );
    return { searches, answerParsed: parseSearchAnswer(rawText) !== null, links, searchMs, tokenUsd };
  };
}

it("free links: usable links found by the web search, at each effort", async () => {
  const settings = evalSettings({ model: SEARCH_MODEL, efforts: ["none", "low", "medium", "high", undefined], repeats: 1 });
  const learned = await loadLearnedSites();

  const { rows, path } = await runSweep({
    task: "free-links",
    title: "Free links eval",
    notes: [
      "The web search for free links on the 10 paywalled stories of `src/pipeline/free-links/__fixtures__/search-answers.json` " +
        "(published 2026-10-13 to 2026-11-09), live: the real search, then the repo's `checkLinks` (site rules, then " +
        `the article reader, ${MIN_WORDS} words or more). Nothing is saved. Learned paywalled sites: ${learned.source}.`,
      "Usable link: kept by `checkLinks`, and the judge (rubric.ts, first 700 words of the article) says it reports the " +
        "same news. Each link is read once and judged once for the whole sweep, so efforts share reads and verdicts, " +
        "and the judge cost column is of the config that first found a link.",
      `Owner's replacement site: stories ${OWNER_REPLACED_STORY_IDS.join(", ")} link today to the article the owner ` +
        "chose by hand; the search is told that site is paywalled and the check drops the story's own site, so this counts " +
        "a returned link on the owner's site before the check.",
      `Cost per story: the search call's tokens plus $${WEB_SEARCH_USD_PER_CALL} per web search call (OpenAI pricing, ` +
        "2026-11-10). 'Cost per call' is tokens only. Search p50/p95 time the search call alone (production: a background " +
        "job, 120 s timeout, one retry); the p50/p95 columns include reads and the judge.",
    ],
    settings,
    items: answers,
    id: (item) => String(item.story.id),
    run: makeRun(learned.sites),
    score: scoreFreeLinks,
    raw: (outcome) =>
      outcome.output
        ? {
            searches: outcome.output.searches,
            searchMs: Math.round(outcome.output.searchMs),
            costUsd: storyCostUsd(outcome.output),
            links: outcome.output.links,
          }
        : {},
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
