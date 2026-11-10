import { listSitemapPosts, readBeehiivPost } from "@/src/pipeline/ingest/beehiiv-site";
import { htmlToText } from "@/src/pipeline/ingest/email-text";
import type { ExtractedStory, Extractor } from "@/src/pipeline/ingest/extract";
import {
  buildHuggingFaceText,
  buildProductHuntText,
  HUGGING_FACE_PAPERS_URL,
  PRODUCT_HUNT_FEED_URL,
} from "@/src/pipeline/ingest/feeds";
import { checkPaywall } from "@/src/pipeline/ingest/paywall";
import { BROWSER_USER_AGENT, resolveTrackingLinks } from "@/src/pipeline/ingest/redirects";
import {
  STORY_SOURCES,
  type BeehiivSiteSource,
  type FeedSource,
  type GmailSource,
  type StorySource,
} from "@/src/pipeline/ingest/sources";
import { cleanStoryUrl, storyGuid } from "@/src/pipeline/ingest/url";
import type { GmailReader } from "@/src/pipeline/publish/gmail-client";

/**
 * Story ingestion, independent of the job runner: read each source since its bookmark, extract stories
 * with the model, and upsert them into `newsletter.stories` (n8n's `1. Fetch Stories`).
 */

/** One `newsletter.stories` row, in n8n's column set. */
export interface StoryRow {
  guid: string;
  /** YYYY-MM-DD */
  day: string;
  headline: string;
  url: string;
  summary: string;
  category: string;
  source: string;
  storyDetails: string;
  importanceScore: number;
  paywallDetected: string;
  error: string;
}

export interface IngestStore {
  readBookmark(source: string): Promise<Date | null>;
  writeBookmark(source: string, at: Date): Promise<void>;
  /** Inserts or updates by guid. Approval and publication columns are never touched. */
  upsertStories(rows: StoryRow[]): Promise<number>;
}

export interface IngestDeps {
  gmail: GmailReader;
  fetch: typeof fetch;
  extract: Extractor;
  store: IngestStore;
  now: Date;
  sources?: StorySource[];
}

export type SourceStatus = "ok" | "no_new" | "partial" | "failed";

export interface SourceResult {
  source: string;
  name: string;
  status: SourceStatus;
  /** Emails (or feed snapshots) read. */
  emails: number;
  stories: number;
  skippedNoLink: number;
  errors: string[];
}

export interface IngestResult {
  /** New York date of the run, as used in the approval link. */
  targetDate: string;
  sources: SourceResult[];
  storiesSaved: number;
}

const LOOKBACK_MS = 72 * 3_600_000;
const EMAIL_LIMIT = 20;
const PAYWALL_CONCURRENCY = 6;
/** Most beehiiv posts read per run, so an outage cannot set off a large backfill. */
const BEEHIIV_POST_LIMIT = 10;
const BEEHIIV_CONCURRENCY = 4;
const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function newYorkDate(date: Date): string {
  return NEW_YORK_DATE.format(date);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function mapInBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return results;
}

/** Cleaned, deduplicated rows. Stories without a usable link are dropped (the board cannot show them). */
async function toRows(
  stories: ExtractedStory[],
  context: { source: string; fixedDay?: string; fetch: typeof fetch },
): Promise<{ rows: StoryRow[]; skippedNoLink: number }> {
  const byGuid = new Map<string, Omit<StoryRow, "paywallDetected" | "error">>();
  let skippedNoLink = 0;
  for (const story of stories) {
    const url = cleanStoryUrl(story.url);
    if (!url) {
      skippedNoLink += 1;
      continue;
    }
    const day = context.fixedDay ?? story.published_at;
    const guid = storyGuid(day, url);
    byGuid.set(guid, {
      guid,
      day,
      headline: story.headline,
      url,
      summary: story.summary,
      category: story.category,
      source: context.source,
      storyDetails: story.story_detail,
      importanceScore: story.importance_score,
    });
  }
  const rows = await mapInBatches([...byGuid.values()], PAYWALL_CONCURRENCY, async (row) => {
    const paywall = await checkPaywall(row.url, { fetch: context.fetch });
    return { ...row, paywallDetected: paywall.status, error: paywall.error };
  });
  return { rows, skippedNoLink };
}

async function ingestEmailSource(source: GmailSource, deps: IngestDeps, result: SourceResult): Promise<void> {
  const bookmark = await deps.store.readBookmark(source.key);
  const cutoff = new Date(Math.max(bookmark?.getTime() ?? 0, deps.now.getTime() - LOOKBACK_MS));
  const query = `from:${source.sender} after:${Math.floor(cutoff.getTime() / 1000)}`;
  const ids = await deps.gmail.listMessageIds(query, EMAIL_LIMIT);
  const messages = (await Promise.all(ids.map((id) => deps.gmail.getMessage(id))))
    .filter((mail) => mail.receivedAt > cutoff)
    .sort((a, b) => a.receivedAt.getTime() - b.receivedAt.getTime());

  // The bookmark only moves past emails that all succeeded, so a failed one is tried again next run.
  let advanceTo: Date | null = null;
  let blocked = false;
  for (const mail of messages) {
    result.emails += 1;
    try {
      const raw = source.body === "html" ? mail.html || mail.text : mail.text || htmlToText(mail.html);
      const resolved = source.trackingLinks
        ? await resolveTrackingLinks(raw, source.trackingLinks, { fetch: deps.fetch })
        : raw;
      const text = source.body === "html" && mail.html ? htmlToText(resolved) : resolved;
      const stories = await deps.extract({ sourceDate: newYorkDate(mail.sentAt), text });
      const { rows, skippedNoLink } = await toRows(stories, { source: source.key, fetch: deps.fetch });
      result.stories += await deps.store.upsertStories(rows);
      result.skippedNoLink += skippedNoLink;
      if (!blocked) advanceTo = mail.receivedAt;
    } catch (error) {
      blocked = true;
      result.errors.push(`${mail.id}: ${message(error)}`);
    }
  }
  if (advanceTo) await deps.store.writeBookmark(source.key, advanceTo);
}

async function ingestFeedSource(source: FeedSource, deps: IngestDeps, result: SourceResult, targetDate: string): Promise<void> {
  const bookmark = await deps.store.readBookmark(source.key);
  const cutoff = new Date(Math.max(bookmark?.getTime() ?? 0, deps.now.getTime() - LOOKBACK_MS));
  const url = source.kind === "product_hunt" ? PRODUCT_HUNT_FEED_URL : HUGGING_FACE_PAPERS_URL;
  const response = await deps.fetch(url, {
    headers: { "user-agent": BROWSER_USER_AGENT },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`${source.name} returned HTTP ${response.status}.`);
  const body = await response.text();
  const feed =
    source.kind === "product_hunt"
      ? buildProductHuntText(body, { cutoff, now: deps.now, targetDate })
      : buildHuggingFaceText(body, { cutoff, targetDate });
  if (feed.count === 0) return;

  result.emails += 1;
  const stories = await deps.extract({ sourceDate: targetDate, text: feed.text });
  // Feed items carry no reliable story date (n8n dated papers by arXiv date, which kept 95 of 319 off the
  // board), so they take the run's date.
  const { rows, skippedNoLink } = await toRows(stories, { source: source.key, fixedDay: targetDate, fetch: deps.fetch });
  result.stories += await deps.store.upsertStories(rows);
  result.skippedNoLink += skippedNoLink;
  await deps.store.writeBookmark(source.key, deps.now);
}

async function fetchPage(url: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, { headers: { "user-agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(20_000) });
}

async function ingestBeehiivSiteSource(source: BeehiivSiteSource, deps: IngestDeps, result: SourceResult): Promise<void> {
  const bookmark = await deps.store.readBookmark(source.key);
  const cutoff = new Date(Math.max(bookmark?.getTime() ?? 0, deps.now.getTime() - LOOKBACK_MS));
  const site = new URL(source.siteUrl);
  const response = await fetchPage(new URL("/sitemap.xml", site).href, deps.fetch);
  if (!response.ok) throw new Error(`${source.name} sitemap returned HTTP ${response.status}.`);

  // `lastmod` is only a day, so a post seen earlier today is fetched again and then skipped below by
  // `publishedAt <= cutoff`, with no model call.
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const candidates = listSitemapPosts(await response.text())
    .filter((post) => post.lastmod !== null && post.lastmod >= cutoffDay && new URL(post.url).host === site.host)
    .sort((a, b) => b.lastmod!.localeCompare(a.lastmod!))
    .slice(0, BEEHIIV_POST_LIMIT);

  const pages = await mapInBatches(candidates, BEEHIIV_CONCURRENCY, async (candidate) => {
    try {
      const page = await fetchPage(candidate.url, deps.fetch);
      if (!page.ok) throw new Error(`HTTP ${page.status}.`);
      return { url: candidate.url, post: readBeehiivPost(await page.text()) };
    } catch (error) {
      // A failed page has no publish time; its lastmod day is the earliest it can block the bookmark.
      return { url: candidate.url, failedAt: new Date(`${candidate.lastmod}T00:00:00Z`), error: message(error) };
    }
  });
  const items = pages
    .filter((page) => !page.post || (page.post.publishedAt > cutoff && page.post.free))
    .sort((a, b) => (a.post?.publishedAt ?? a.failedAt!).getTime() - (b.post?.publishedAt ?? b.failedAt!).getTime());

  // Same rule as emails: the bookmark only moves past posts that all succeeded.
  let advanceTo: Date | null = null;
  let blocked = false;
  for (const item of items) {
    result.emails += 1;
    try {
      if (!item.post) throw new Error(item.error);
      const stories = await deps.extract({ sourceDate: newYorkDate(item.post.publishedAt), text: item.post.text });
      const { rows, skippedNoLink } = await toRows(stories, { source: source.key, fetch: deps.fetch });
      result.stories += await deps.store.upsertStories(rows);
      result.skippedNoLink += skippedNoLink;
      if (!blocked) advanceTo = item.post.publishedAt;
    } catch (error) {
      blocked = true;
      result.errors.push(`${item.url}: ${message(error)}`);
    }
  }
  if (advanceTo) await deps.store.writeBookmark(source.key, advanceTo);
}

function finalStatus(result: SourceResult): SourceStatus {
  if (result.errors.length === 0) return result.emails === 0 ? "no_new" : "ok";
  return result.emails > result.errors.length ? "partial" : "failed";
}

export async function ingestStories(deps: IngestDeps): Promise<IngestResult> {
  const targetDate = newYorkDate(deps.now);
  const sources = deps.sources ?? STORY_SOURCES;

  const results = await Promise.all(
    sources.map(async (source) => {
      const result: SourceResult = {
        source: source.key,
        name: source.name,
        status: "ok",
        emails: 0,
        stories: 0,
        skippedNoLink: 0,
        errors: [],
      };
      try {
        switch (source.kind) {
          case "gmail":
            await ingestEmailSource(source, deps, result);
            break;
          case "beehiiv_site":
            await ingestBeehiivSiteSource(source, deps, result);
            break;
          case "product_hunt":
          case "hugging_face":
            await ingestFeedSource(source, deps, result, targetDate);
            break;
          default: {
            const unknown: never = source;
            throw new Error(`Unknown source kind: ${JSON.stringify(unknown)}`);
          }
        }
      } catch (error) {
        result.errors.push(message(error));
      }
      result.status = finalStatus(result);
      return result;
    }),
  );

  return { targetDate, sources: results, storiesSaved: results.reduce((sum, result) => sum + result.stories, 0) };
}
