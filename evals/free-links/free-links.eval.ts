// The web search for free links (src/pipeline/free-links/search.ts) on the paywalled stories of
// evals/free-links/stories.json that have a golden value, with the repo's own check of each link (check-links.ts:
// site rules, then the article reader), scored against the golden values. evals/README.md.
// It replaces the old opt-in live test, and writes nothing: no free links are saved and no paywalled site is recorded.
import { expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { WEB_SEARCH_USD_PER_CALL } from "@/evals/lib/usage";
import { GOLDEN_PATH } from "@/evals/free-links/golden";
import { ARTICLE_WORDS_FOR_JUDGE, sameNewsInput, SAME_NEWS_INSTRUCTIONS, SAME_NEWS_SCHEMA } from "@/evals/free-links/rubric";
import {
  OWNER_REPLACED_STORY_IDS,
  scoreFreeLinks,
  type CheckedFoundLink,
  type FreeLinksGolden,
  type FreeLinksGrade,
  type FreeLinksOutput,
  type SameNews,
} from "@/evals/free-links/score";
import { goldenInput, readStories, STORIES_PATH, type PaywalledStory } from "@/evals/free-links/stories";
import { goldenFor, loadGolden, missingGolden } from "@/evals/lib/golden";
import { readerOptionsFromEnv } from "@/src/pipeline/draft/articles/draft-reader";
import { readArticles } from "@/src/pipeline/draft/articles/read-articles";
import { checkLinks, countWords, READ_DEADLINE_MS, type LinkRead } from "@/src/pipeline/free-links/check-links";
import { isLearned } from "@/src/pipeline/free-links/paywall-sites";
import { parseSearchAnswer, SEARCH_EFFORT, SEARCH_MODEL, searchFreeLinks } from "@/src/pipeline/free-links/search";
import { MIN_WORDS, siteOf } from "@/src/pipeline/free-links/sites";
import { checkSiteList } from "@/src/pipeline/ingest/paywall";

interface Item {
  story: PaywalledStory;
  golden: FreeLinksGolden;
}

/** The stories with a golden value. One whose input changed since its value was made stops the run (goldenFor). */
function goldenItems(): { items: Item[]; missing: string[] } {
  const golden = loadGolden<FreeLinksGolden>(GOLDEN_PATH);
  const stories = readStories();
  const missing = missingGolden(golden, stories.map((story) => ({ id: String(story.id), input: goldenInput(story) })));
  const items = stories
    .filter((story) => golden.entries[String(story.id)])
    .map((story) => ({ story, golden: goldenFor(golden, String(story.id), goldenInput(story)) }));
  return { items, missing };
}

/** The learned paywalled sites on the Neon dev branch (read-only), as the job would use them. */
async function loadLearnedSites(): Promise<{ sites: string[]; source: string }> {
  const rows = await readOnlyQuery<{ site: string; story_ids: number[]; ignored: boolean }>(
    "SELECT site, story_ids, ignored FROM newsletter.paywall_sites"
  );
  if (rows === null) return { sites: [], source: "none (DATABASE_URL not set)" };
  const sites = rows.filter((row) => isLearned({ storyIds: row.story_ids, ignored: row.ignored })).map((row) => row.site);
  return { sites, source: `${sites.length} from the Neon dev branch` };
}

const storyOf = (item: Item) => ({ id: item.story.id, headline: item.story.headline, summary: item.story.summary, url: item.story.url });

/** The search call alone: this is the timed part. */
async function search(item: Item, context: RunContext): Promise<FreeLinksOutput> {
  const found = await searchFreeLinks(storyOf(item), { client: context.client, model: context.config.model, effort: context.config.effort, log: () => undefined });
  const answer = context.responses().at(-1)?.output_text ?? "";
  return { answerParsed: parseSearchAnswer(answer) !== null, found };
}

/**
 * The repo's check of the found links, then the judge on each kept link. Reads and verdicts are shared work: each
 * link is read once, and each (story, link) judged once, for the whole sweep, so every effort is checked against
 * the same reads. The reader is the repo's, with the step's deadline, one link at a time.
 */
function makeGrade(learnedSites: string[]) {
  return async function grade(item: Item, output: FreeLinksOutput, context: GradeContext): Promise<FreeLinksGrade> {
    const story = storyOf(item);
    const readOnce = (url: string) =>
      context.shared<LinkRead>(`read:${url}`, async () => {
        const { reads } = await readArticles([{ id: 0, url }], { deadlineMs: READ_DEADLINE_MS, ...readerOptionsFromEnv(process.env) });
        return { url, status: reads[0].status, text: reads[0].text };
      });

    const sentToRead = new Set<string>();
    const kept = await checkLinks(story, output.found, {
      learnedSites,
      read: async (urls) => {
        urls.forEach((url) => sentToRead.add(url));
        return Promise.all(urls.map(readOnce));
      },
      recordPaywalledSite: async () => undefined,
    });
    const keptUrls = new Set(kept.map((link) => link.url));

    const links = await Promise.all(
      output.found.map(async (link): Promise<CheckedFoundLink> => {
        const read = sentToRead.has(link.url) ? await readOnce(link.url) : null;
        const isKept = keptUrls.has(link.url);
        const text = read?.text;
        const sameNews =
          isKept && text
            ? await context.shared<SameNews | null>(`verdict:${story.id}|${link.url}`, ({ judge }) =>
                judge<{ same_news: SameNews }>({
                  name: "same_news",
                  instructions: SAME_NEWS_INSTRUCTIONS,
                  input: sameNewsInput(item.story, link, text),
                  schema: SAME_NEWS_SCHEMA,
                })
                  .then((answer) => answer.same_news)
                  .catch(() => null)
              )
            : null;
        return {
          url: link.url,
          site: siteOf(link.url) ?? "",
          onPaywallSite: checkSiteList(link.url, learnedSites) === "yes",
          read: read !== null,
          readStatus: read?.status ?? null,
          words: kept.find((entry) => entry.url === link.url)?.words ?? (text ? countWords(text) : 0),
          kept: isKept,
          sameNews,
        };
      })
    );
    return { links };
  };
}

it("free links: usable links found by the web search, at each effort", async () => {
  const settings = evalSettings({
    model: SEARCH_MODEL,
    efforts: ["low", "medium"],
    repeats: 1,
    baseline: SEARCH_EFFORT,
  });
  const learned = await loadLearnedSites();
  const { items, missing } = goldenItems();
  if (items.length === 0) throw new Error(`No story of ${STORIES_PATH} has a golden value yet: see evals/free-links/golden-todo.md.`);
  const withFree = items.filter((item) => item.golden.free_source_exists).length;

  const { rows, path } = await runSweep({
    task: "free-links",
    title: "Free links eval",
    notes: [
      `The web search for free links on the ${items.length} paywalled stories of \`${STORIES_PATH}\` with a golden value ` +
        `(${missing.length} without one are left out), live: the real search, then the repo's \`checkLinks\` (site rules, then ` +
        `the article reader, ${MIN_WORDS} words or more). Nothing is saved. Learned paywalled sites: ${learned.source}.`,
      `Golden (\`evals/free-links/golden.json\`, Claude Opus with web search, golden-todo.md): ${withFree} stories have a ` +
        "free source. Recall is over those stories; precision is over the kept links the judge graded; the stories with " +
        "no free source are counted apart, and 'Kept links among golden URLs' needs no judge.",
      `Usable link: kept by \`checkLinks\`, and the judge (rubric.ts, first ${ARTICLE_WORDS_FOR_JUDGE} words of the article) ` +
        "says it reports the same news. Each link is read once and judged once for the whole sweep, so efforts share " +
        "reads and verdicts; their cost is the shared-work line under the table.",
      `Owner's replacement site: stories ${OWNER_REPLACED_STORY_IDS.join(", ")} link today to the article the owner ` +
        "chose by hand; the search is told that site is paywalled and the check drops the story's own site, so this counts " +
        "a returned link on the owner's site before the check.",
      `Cost per call: the search call's tokens plus $${WEB_SEARCH_USD_PER_CALL} per web search call (OpenAI pricing, ` +
        "2026-11-10). p50/p95 time the search call alone (production: a background job, 120 s timeout, one retry). " +
        "Rows with git sha 035179c+changes or d42bcb1+changes (before d1da5b8): 'Cost per call' is tokens only (the " +
        "total is 'Cost per story ¢'), p50/p95 include " +
        "reads and the judge (the search alone is 'Search p50 s'), and the judge cost is of the config that first found a link.",
    ],
    settings,
    items,
    id: (item) => String(item.story.id),
    run: search,
    grade: makeGrade(learned.sites),
    score: scoreFreeLinks,
    raw: (outcome) => ({
      searches: outcome.usage.webSearches,
      callMs: outcome.callMs,
      links: outcome.grade?.links ?? null,
    }),
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
