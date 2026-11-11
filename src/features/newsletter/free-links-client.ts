/** The board's side of the paywall rules and the free links of a story (#59). */

import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

const STATES: readonly unknown[] = ["yes", "no", "unknown", "error"] satisfies PaywallStatus[];

interface CheckLinkOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Asks /api/approval/check-link if a link the owner typed is paywalled. Never throws: a failure is "error". */
export async function checkLink(url: string, options: CheckLinkOptions = {}): Promise<PaywallStatus> {
  const { fetcher = (input, init) => fetch(input, init) } = options;
  try {
    const response = await fetcher("/api/approval/check-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return "error";
    const reply = (await response.json()) as { paywall?: unknown };
    return STATES.includes(reply.paywall) ? (reply.paywall as PaywallStatus) : "error";
  } catch {
    return "error";
  }
}

export interface FreeLink {
  url: string;
  site: string;
  title: string | null;
  words: number;
}

/** The free links of one story, and if the search for them finished. */
export interface StoryFreeLinks {
  done: boolean;
  links: FreeLink[];
}

export type FreeLinksByStory = Record<number, StoryFreeLinks>;

/** The board asks for the free links this often, */
export const POLL_MS = 3_000;
/** and for this long. A search that takes longer still saves its links; the next board load shows them. */
export const POLL_LIMIT_MS = 120_000;

interface WatchFreeLinksOptions {
  /** Gets the stories' free links each time they are read. The last call has every story done. */
  onUpdate: (stories: FreeLinksByStory) => void;
  fetcher?: (url: string, init?: RequestInit) => Promise<Response>;
  wait?: (ms: number) => Promise<void>;
}

/**
 * Starts the search for free links of the stories and reports what it finds, until every story is done or 2
 * minutes passed. Never throws: when the search did not start, it reports the links found before, once.
 */
export async function watchFreeLinks(storyIds: number[], options: WatchFreeLinksOptions): Promise<void> {
  if (storyIds.length === 0) return;
  const { fetcher = (input, init) => fetch(input, init), wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = options;

  const started = await fetcher("/api/approval/free-links", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ story_ids: storyIds }),
  })
    .then((response) => response.ok)
    .catch(() => false);

  const read = async (): Promise<FreeLinksByStory | null> => {
    try {
      const response = await fetcher(`/api/approval/free-links?ids=${storyIds.join(",")}`);
      if (!response.ok) return null;
      const reply = (await response.json()) as { stories?: FreeLinksByStory };
      return reply.stories ?? null;
    } catch {
      return null;
    }
  };

  let latest: FreeLinksByStory = {};
  for (let waited = 0; ; waited += POLL_MS) {
    const stories = await read();
    if (stories) {
      latest = stories;
      if (storyIds.every((id) => stories[id]?.done)) return options.onUpdate(stories);
    }
    if (!started || waited >= POLL_LIMIT_MS) break;
    if (stories) options.onUpdate(stories);
    await wait(POLL_MS);
  }
  options.onUpdate(Object.fromEntries(storyIds.map((id) => [id, { done: true, links: latest[id]?.links ?? [] }])));
}
