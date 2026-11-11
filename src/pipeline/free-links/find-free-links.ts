import { readerOptionsFromEnv } from "@/src/pipeline/draft/articles/draft-reader";
import { checkLinks, type CheckedLink, type LinkCandidate } from "@/src/pipeline/free-links/check-links";
import { learnedSitesOrNone } from "@/src/pipeline/free-links/paywall-sites";
import { searchFreeLinks, type FoundLink } from "@/src/pipeline/free-links/search";
import { DEFAULT_WINDOW_DAYS, pairLevel } from "@/src/pipeline/repeats/repeat-rules";
import { prisma } from "@/src/server/prisma";

/**
 * The search for free links (#59). For each story whose link is paywalled and that was not searched before:
 * first our own stories that report the same news, then one web search. Every link is checked (check-links.ts)
 * before it is saved. A story is marked as searched also when it has no free link, so it is searched only once.
 */

/** Stories worked on at once. One story can take a web search (up to 2 minutes) and a read (45 s). */
export const STORIES_AT_ONCE = 3;
/** The background function has 15 minutes. No new story starts after this. */
export const TIME_LIMIT_MS = 11 * 60_000;

export interface FreeLinkStory {
  id: number;
  headline: string | null;
  summary: string | null;
  /** The paywalled link. */
  url: string;
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
  /** Of the given stories, those with a paywalled link that were not searched before. */
  storiesToSearch(ids: number[]): Promise<FreeLinkStory[]>;
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

export const prismaFreeLinksStore: FreeLinksStore = {
  async storiesToSearch(ids) {
    if (ids.length === 0) return [];
    const rows = await prisma.story.findMany({
      where: { id: { in: ids }, paywallDetected: "yes", freeLinksCheckedAt: null, url: { not: null } },
      orderBy: { id: "asc" },
      select: { id: true, headline: true, summary: true, url: true },
    });
    return rows.flatMap((row) => (row.url ? [{ ...row, url: row.url }] : []));
  },

  async ownStories(story) {
    const matches = await prisma.storyMatch.findMany({ where: { OR: [{ newerStoryId: story.id }, { olderStoryId: story.id }] } });
    const sameByStory = new Map<number, number>();
    for (const match of matches) {
      if (pairLevel(match) !== "sure") continue;
      sameByStory.set(match.newerStoryId === story.id ? match.olderStoryId : match.newerStoryId, match.same);
    }
    if (sameByStory.size === 0) return [];

    const self = await prisma.story.findUnique({ where: { id: story.id }, select: { day: true } });
    if (!self?.day) return [];
    const window = DEFAULT_WINDOW_DAYS * DAY_MS;
    const rows = await prisma.story.findMany({
      where: {
        id: { in: [...sameByStory.keys()] },
        url: { not: null },
        paywallDetected: { in: ["no", "unknown"] },
        day: { gte: new Date(self.day.getTime() - window), lte: new Date(self.day.getTime() + window) },
      },
      select: { id: true, url: true, headline: true },
    });
    return rows
      .flatMap((row) => (row.url ? [{ ...row, url: row.url }] : []))
      .sort((a, b) => (sameByStory.get(b.id) ?? 0) - (sameByStory.get(a.id) ?? 0) || a.id - b.id);
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

  const waiting = await store.storiesToSearch(storyIds);
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
      run.stories += 1;
      try {
        await findFor(story);
      } catch (error) {
        run.failed += 1;
        log(`[free-links] Story ${story.id}: ${describeError(error)}`);
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
