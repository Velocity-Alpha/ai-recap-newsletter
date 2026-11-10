import { listSitemapPosts, readPostMeta, readPostText, type PostMeta } from "@/src/pipeline/ingest/beehiiv-site";
import { htmlToText } from "@/src/pipeline/ingest/email-text";
import type { ExtractedStory, ExtractionInput, Extractor } from "@/src/pipeline/ingest/extract";
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
  /** Items read: emails, feed snapshots or posts. */
  items: number;
  stories: number;
  /** Stories with no usable link (none, or a link to the source's own site). */
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
const FETCH_TIMEOUT_MS = 20_000;
const EMAIL_LIMIT = 20;
const PAYWALL_CONCURRENCY = 6;
/** Most beehiiv post pages read per run. More is reported as an error, so a backlog is seen, not dropped. */
const BEEHIIV_PAGE_LIMIT = 30;
const BEEHIIV_PAGE_CONCURRENCY = 4;
const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });

export function newYorkDate(date: Date): string {
  return NEW_YORK_DATE.format(date);
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Host without a leading `www.`, so `www.example.org` and `example.org` match. */
function siteHost(url: string): string {
  return new URL(url).host.toLowerCase().replace(/^www\./, "");
}

async function mapInBatches<T, R>(items: T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (let start = 0; start < items.length; start += size) {
    results.push(...(await Promise.all(items.slice(start, start + size).map(run))));
  }
  return results;
}

function fetchPage(url: string, fetchImpl: typeof fetch): Promise<Response> {
  return fetchImpl(url, { headers: { "user-agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
}

/** The later of the source's bookmark and the lookback limit. */
async function readCutoff(source: string, deps: IngestDeps): Promise<Date> {
  const bookmark = await deps.store.readBookmark(source);
  return new Date(Math.max(bookmark?.getTime() ?? 0, deps.now.getTime() - LOOKBACK_MS));
}

interface RowContext {
  source: string;
  fixedDay?: string;
  /** Stories linking to this host (the newsletter's own site) are dropped like stories with no link. */
  ownHost?: string;
}

/** Cleaned, deduplicated rows. Stories without a usable link are dropped (the board cannot show them). */
async function toRows(
  stories: ExtractedStory[],
  context: RowContext & { fetch: typeof fetch },
): Promise<{ rows: StoryRow[]; skippedNoLink: number }> {
  const byGuid = new Map<string, Omit<StoryRow, "paywallDetected" | "error">>();
  let skippedNoLink = 0;
  for (const story of stories) {
    const url = cleanStoryUrl(story.url);
    if (!url || (context.ownHost && siteHost(url) === context.ownHost)) {
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

/** Extracts stories from one item's text and saves them. */
async function saveStories(input: ExtractionInput, context: RowContext, deps: IngestDeps, result: SourceResult): Promise<void> {
  const stories = await deps.extract(input);
  const { rows, skippedNoLink } = await toRows(stories, { ...context, fetch: deps.fetch });
  result.stories += await deps.store.upsertStories(rows);
  result.skippedNoLink += skippedNoLink;
}

/**
 * Runs items oldest first, counting each and recording failures. Returns the time the bookmark may move to:
 * the last item of the unbroken run of successes from the oldest, so a failed item is tried again next run.
 * `blocked` keeps the bookmark where it is.
 */
async function processInOrder<T>(
  items: T[],
  options: { result: SourceResult; label: (item: T) => string; at: (item: T) => Date; run: (item: T) => Promise<void>; blocked?: boolean },
): Promise<Date | null> {
  let advanceTo: Date | null = null;
  let blocked = options.blocked ?? false;
  for (const item of [...items].sort((a, b) => options.at(a).getTime() - options.at(b).getTime())) {
    options.result.items += 1;
    try {
      await options.run(item);
      if (!blocked) advanceTo = options.at(item);
    } catch (error) {
      blocked = true;
      options.result.errors.push(`${options.label(item)}: ${message(error)}`);
    }
  }
  return advanceTo;
}

async function ingestEmailSource(source: GmailSource, deps: IngestDeps, result: SourceResult): Promise<void> {
  const cutoff = await readCutoff(source.key, deps);
  const query = `from:${source.sender} after:${Math.floor(cutoff.getTime() / 1000)}`;
  const ids = await deps.gmail.listMessageIds(query, EMAIL_LIMIT);
  const messages = (await Promise.all(ids.map((id) => deps.gmail.getMessage(id)))).filter((mail) => mail.receivedAt > cutoff);

  const advanceTo = await processInOrder(messages, {
    result,
    label: (mail) => mail.id,
    at: (mail) => mail.receivedAt,
    run: async (mail) => {
      const raw = source.body === "html" ? mail.html || mail.text : mail.text || htmlToText(mail.html);
      const resolved = source.trackingLinks
        ? await resolveTrackingLinks(raw, source.trackingLinks, { fetch: deps.fetch })
        : raw;
      const text = source.body === "html" && mail.html ? htmlToText(resolved) : resolved;
      await saveStories({ sourceDate: newYorkDate(mail.sentAt), text }, { source: source.key }, deps, result);
    },
  });
  if (advanceTo) await deps.store.writeBookmark(source.key, advanceTo);
}

async function ingestFeedSource(source: FeedSource, deps: IngestDeps, result: SourceResult, targetDate: string): Promise<void> {
  const cutoff = await readCutoff(source.key, deps);
  const url = source.kind === "product_hunt" ? PRODUCT_HUNT_FEED_URL : HUGGING_FACE_PAPERS_URL;
  const response = await fetchPage(url, deps.fetch);
  if (!response.ok) throw new Error(`${source.name} returned HTTP ${response.status}.`);
  const body = await response.text();
  const feed =
    source.kind === "product_hunt"
      ? buildProductHuntText(body, { cutoff, now: deps.now, targetDate })
      : buildHuggingFaceText(body, { cutoff, targetDate });
  if (feed.count === 0) return;

  result.items += 1;
  // Feed items carry no reliable story date (n8n dated papers by arXiv date, which kept 95 of 319 off the
  // board), so they take the run's date.
  await saveStories({ sourceDate: targetDate, text: feed.text }, { source: source.key, fixedDay: targetDate }, deps, result);
  await deps.store.writeBookmark(source.key, deps.now);
}

/** Post pages changed on or after the cutoff's day, newest first, at most `BEEHIIV_PAGE_LIMIT`. */
async function listChangedPosts(source: BeehiivSiteSource, cutoff: Date, deps: IngestDeps): Promise<{ urls: string[]; overflow?: string }> {
  const response = await fetchPage(new URL("/sitemap.xml", source.siteUrl).href, deps.fetch);
  if (!response.ok) throw new Error(`${source.name} sitemap returned HTTP ${response.status}.`);
  const host = siteHost(source.siteUrl);
  const posts = listSitemapPosts(await response.text()).filter((post) => siteHost(post.url) === host);
  if (posts.length === 0) throw new Error(`${source.name} sitemap lists no posts.`);

  // beehiiv's lastmod is the UTC day (checked 2026-11-10 against posts published at 03:01Z and 14:11Z).
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const changed = posts
    .flatMap((post) => (post.lastmod !== null && post.lastmod >= cutoffDay ? [{ url: post.url, lastmod: post.lastmod }] : []))
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod));
  const overflow =
    changed.length > BEEHIIV_PAGE_LIMIT
      ? `${source.name}: ${changed.length} posts changed since ${cutoffDay}; read the ${BEEHIIV_PAGE_LIMIT} newest.`
      : undefined;
  return { urls: changed.slice(0, BEEHIIV_PAGE_LIMIT).map((post) => post.url), overflow };
}

type PostPage = { ok: true; url: string; html: string; meta: PostMeta } | { ok: false; url: string; error: string };

async function readPostPage(url: string, fetchImpl: typeof fetch): Promise<PostPage> {
  try {
    const response = await fetchPage(url, fetchImpl);
    if (!response.ok) throw new Error(`HTTP ${response.status}.`);
    const html = await response.text();
    return { ok: true, url, html, meta: readPostMeta(html) };
  } catch (error) {
    return { ok: false, url, error: message(error) };
  }
}

async function ingestBeehiivSiteSource(source: BeehiivSiteSource, deps: IngestDeps, result: SourceResult): Promise<void> {
  const cutoff = await readCutoff(source.key, deps);
  const { urls, overflow } = await listChangedPosts(source, cutoff, deps);
  const pages = await mapInBatches(urls, BEEHIIV_PAGE_CONCURRENCY, (url) => readPostPage(url, deps.fetch));

  // A post whose page failed has no known date, so any failure (or unread overflow) keeps the bookmark.
  const failed = pages.flatMap((page) => (page.ok ? [] : [`${page.url}: ${page.error}`]));
  result.items += failed.length;
  result.errors.push(...failed, ...(overflow ? [overflow] : []));

  // lastmod is only a day, so a post read earlier today is fetched again and skipped here, with no model call.
  const posts = pages.flatMap((page) => (page.ok && page.meta.free && page.meta.publishedAt > cutoff ? [page] : []));
  const advanceTo = await processInOrder(posts, {
    result,
    blocked: failed.length > 0 || overflow !== undefined,
    label: (post) => post.url,
    at: (post) => post.meta.publishedAt,
    run: (post) =>
      saveStories(
        { sourceDate: newYorkDate(post.meta.publishedAt), text: readPostText(post.html) },
        { source: source.key, ownHost: siteHost(source.siteUrl) },
        deps,
        result,
      ),
  });
  if (advanceTo) await deps.store.writeBookmark(source.key, advanceTo);
}

function finalStatus(result: SourceResult): SourceStatus {
  if (result.errors.length === 0) return result.items === 0 ? "no_new" : "ok";
  return result.items > result.errors.length ? "partial" : "failed";
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
        items: 0,
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
