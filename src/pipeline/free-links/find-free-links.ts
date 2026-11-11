import { readerOptionsFromEnv } from "@/src/pipeline/draft/articles/draft-reader";
import { checkLinks, type CheckedLink, type LinkCandidate } from "@/src/pipeline/free-links/check-links";
import { learnedSitesOrNone } from "@/src/pipeline/free-links/paywall-sites";
import { searchFreeLinks, type FoundLink } from "@/src/pipeline/free-links/search";
import { DEFAULT_WINDOW_DAYS, pairLevel, type StoryMatchRow } from "@/src/pipeline/repeats/repeat-rules";
import { prisma } from "@/src/server/prisma";

/**
 * The search for free links (#59). For each story whose link is paywalled and that was not searched before:
 * first our own stories that report the same news, then one web search. Every link is checked (check-links.ts)
 * before it is saved. A story is marked as searched also when it has no free link, so it is searched only once.
 * A run claims a story before it works on it, so two runs at the same time do not search the same story.
 */

/** Stories worked on at once. */
export const STORIES_AT_ONCE = 3;
/**
 * The background function has 15 minutes. One story can take a web search (2 minutes, tried twice) and two
 * reads (2 minutes each), so no new story starts after this.
 */
export const TIME_LIMIT_MS = 6 * 60_000;
/** A claim lasts as long as the background function can run. After that another run can take the story. */
export const CLAIM_MS = 15 * 60_000;

export interface FreeLinkStory {
  id: number;
  headline: string | null;
  summary: string | null;
  /** The paywalled link. */
  url: string;
  day: Date | null;
}

/** One of our own stories that reports the same news as a paywalled story. */
export interface OwnStory {
  id: number;
  url: string;
  headline: string | null;
}

export interface SavedLink extends CheckedLink {
  origin: "story" | "search";
  originStoryId: number | null;
}

export interface FreeLinksStore {
  /** Of the given stories, those with a paywalled link that were not searched before and that no run works on. */
  storiesToSearch(ids: number[], now: Date): Promise<FreeLinkStory[]>;
  /** Takes the story for this run. False when another run took it first, or the story was searched meanwhile. */
  claim(storyId: number, now: Date): Promise<boolean>;
  /** Gives the story back after an error, so the next run can search it. */
  release(storyId: number): Promise<void>;
  /** Our own stories that are surely the same news, from the days near the story, with a link not known as paywalled. */
  ownStories(story: FreeLinkStory): Promise<OwnStory[]>;
  /** Replaces the story's free links, in order, and marks the story as searched. */
  save(storyId: number, links: SavedLink[], at: Date): Promise<void>;
}

export interface FindFreeLinksDeps {
  store?: FreeLinksStore;
  search?: (story: FreeLinkStory) => Promise<FoundLink[]>;
  checkLinks?: (story: { id: number; url: string }, candidates: LinkCandidate[]) => Promise<CheckedLink[]>;
  log?: (message: string) => void;
  now?: () => Date;
  concurrency?: number;
  timeLimitMs?: number;
}

export interface FreeLinksRun {
  /** Stories the run worked on. */
  stories: number;
  /** Stories that got their free links from our own stories. */
  fromStories: number;
  /** Web searches made. */
  searched: number;
  /** Free links saved. */
  links: number;
  /** Stories that had an error. They stay not searched. */
  failed: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The ids of the stories that are surely the same news as the story, the surest first. A story match can name
 * the story as the newer or the older one of the pair.
 */
export function surePartners(storyId: number, matches: readonly Pick<StoryMatchRow, "newerStoryId" | "olderStoryId" | "same" | "news">[]): number[] {
  return matches
    .filter((match) => (match.newerStoryId === storyId || match.olderStoryId === storyId) && pairLevel(match) === "sure")
    .map((match) => ({ id: match.newerStoryId === storyId ? match.olderStoryId : match.newerStoryId, same: match.same }))
    .sort((a, b) => b.same - a.same || a.id - b.id)
    .map((partner) => partner.id);
}

/** A story a run can take: paywalled, not searched, and not claimed in the last CLAIM_MS. */
function waitingStory(now: Date) {
  return {
    paywallDetected: "yes",
    freeLinksCheckedAt: null,
    url: { not: null },
    OR: [{ freeLinksStartedAt: null }, { freeLinksStartedAt: { lt: new Date(now.getTime() - CLAIM_MS) } }],
  };
}

export const prismaFreeLinksStore: FreeLinksStore = {
  async storiesToSearch(ids, now) {
    if (ids.length === 0) return [];
    const rows = await prisma.story.findMany({
      where: { id: { in: ids }, ...waitingStory(now) },
      orderBy: { id: "asc" },
      select: { id: true, headline: true, summary: true, url: true, day: true },
    });
    return rows.flatMap((row) => (row.url ? [{ ...row, url: row.url }] : []));
  },

  async claim(storyId, now) {
    // One statement: of two runs at the same time, only one changes the row.
    const { count } = await prisma.story.updateMany({ where: { id: storyId, ...waitingStory(now) }, data: { freeLinksStartedAt: now } });
    return count === 1;
  },

  async release(storyId) {
    await prisma.story.updateMany({ where: { id: storyId, freeLinksCheckedAt: null }, data: { freeLinksStartedAt: null } });
  },

  async ownStories(story) {
    if (!story.day) return [];
    const matches = await prisma.storyMatch.findMany({ where: { OR: [{ newerStoryId: story.id }, { olderStoryId: story.id }] } });
    const partners = surePartners(story.id, matches);
    if (partners.length === 0) return [];

    const window = DEFAULT_WINDOW_DAYS * DAY_MS;
    const rows = await prisma.story.findMany({
      where: {
        id: { in: partners },
        url: { not: null },
        paywallDetected: { in: ["no", "unknown"] },
        day: { gte: new Date(story.day.getTime() - window), lte: new Date(story.day.getTime() + window) },
      },
      select: { id: true, url: true, headline: true },
    });
    return partners.flatMap((id) => {
      const row = rows.find((candidate) => candidate.id === id);
      return row?.url ? [{ ...row, url: row.url }] : [];
    });
  },

  async save(storyId, links, at) {
    await prisma.$transaction([
      prisma.storyFreeLink.deleteMany({ where: { storyId } }),
      prisma.storyFreeLink.createMany({ data: links.map((link, position) => ({ storyId, position, ...link })) }),
      prisma.story.update({ where: { id: storyId }, data: { freeLinksCheckedAt: at } }),
    ]);
  },
};

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function defaultCheckLinks(): Promise<NonNullable<FindFreeLinksDeps["checkLinks"]>> {
  const sites = await learnedSitesOrNone();
  const readOptions = readerOptionsFromEnv(process.env);
  return (story, candidates) => checkLinks(story, candidates, { learnedSites: sites, readOptions });
}

export async function findFreeLinks(storyIds: number[], deps: FindFreeLinksDeps = {}): Promise<FreeLinksRun> {
  const store = deps.store ?? prismaFreeLinksStore;
  const search = deps.search ?? ((story: FreeLinkStory) => searchFreeLinks(story));
  const log = deps.log ?? console.error;
  const now = deps.now ?? (() => new Date());
  const run: FreeLinksRun = { stories: 0, fromStories: 0, searched: 0, links: 0, failed: 0 };

  const waiting = await store.storiesToSearch(storyIds, now());
  if (waiting.length === 0) return run;
  const check = deps.checkLinks ?? (await defaultCheckLinks());
  const stopAt = now().getTime() + (deps.timeLimitMs ?? TIME_LIMIT_MS);

  async function findFor(story: FreeLinkStory): Promise<void> {
    const own = await store.ownStories(story);
    const fromOwn = await check(story, own.map((entry) => ({ url: entry.url, title: entry.headline })));
    let links: SavedLink[] = fromOwn.map((link) => ({
      ...link,
      origin: "story",
      originStoryId: own.find((entry) => entry.url === link.url)?.id ?? null,
    }));
    if (links.length > 0) {
      run.fromStories += 1;
    } else {
      run.searched += 1;
      const found = await check(story, await search(story));
      links = found.map((link) => ({ ...link, origin: "search", originStoryId: null }));
    }
    await store.save(story.id, links, now());
    run.links += links.length;
  }

  async function worker(): Promise<void> {
    for (let story = waiting.shift(); story; story = waiting.shift()) {
      if (now().getTime() >= stopAt) return;
      // Another run can have taken the story since the list was read.
      if (!(await store.claim(story.id, now()))) continue;
      run.stories += 1;
      try {
        await findFor(story);
      } catch (error) {
        run.failed += 1;
        log(`[free-links] Story ${story.id}: ${describeError(error)}`);
        await store.release(story.id).catch(() => undefined);
      }
    }
  }
  await Promise.all(Array.from({ length: deps.concurrency ?? STORIES_AT_ONCE }, worker));
  return run;
}

export function describeFreeLinksRun(run: FreeLinksRun): string {
  return (
    `Looked for free links for ${run.stories} stories: ${run.fromStories} from our own stories, ${run.searched} web searches, ` +
    `${run.links} free links saved, ${run.failed} failed.`
  );
}
