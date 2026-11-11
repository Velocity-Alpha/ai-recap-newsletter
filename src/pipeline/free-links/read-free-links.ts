import { prisma } from "@/src/server/prisma";

/** What the board shows for one story (#59): if the search finished, and the free links it found, best first. */
export interface StoryFreeLinks {
  /** True when the search finished for the story, or the story's link is not paywalled, so no search will run. */
  done: boolean;
  links: { url: string; site: string; title: string | null; words: number }[];
}

/** The free links of the given stories, by story id. A story that does not exist is done, with no links. */
export async function readFreeLinks(storyIds: number[]): Promise<Record<number, StoryFreeLinks>> {
  if (storyIds.length === 0) return {};
  const [stories, links] = await Promise.all([
    prisma.story.findMany({ where: { id: { in: storyIds } }, select: { id: true, paywallDetected: true, freeLinksCheckedAt: true } }),
    prisma.storyFreeLink.findMany({
      where: { storyId: { in: storyIds } },
      orderBy: [{ storyId: "asc" }, { position: "asc" }],
      select: { storyId: true, url: true, site: true, title: true, words: true },
    }),
  ]);
  const waiting = new Set(stories.filter((story) => story.paywallDetected === "yes" && story.freeLinksCheckedAt === null).map((story) => story.id));
  return Object.fromEntries(
    storyIds.map((id) => [
      id,
      {
        done: !waiting.has(id),
        links: links.filter((link) => link.storyId === id).map(({ url, site, title, words }) => ({ url, site, title, words })),
      },
    ]),
  );
}
