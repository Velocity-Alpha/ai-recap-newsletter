import { listSitemapPosts, readPostMeta, readPostText, type PostMeta, type SitemapPost } from "@/src/pipeline/ingest/beehiiv-site";
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
  /** Emails, feed snapshots or posts read. */
  documents: number;
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
/** Most beehiiv post pages read per run (the page cap). More is reported as an error, so a backlog is seen. */
export const BEEHIIV_PAGE_LIMIT = 30;
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

/** Extracts stories from one document's text and saves them. */
async function extractAndSave(options: { input: ExtractionInput; rows: RowContext; deps: IngestDeps; result: SourceResult }): Promise<void> {
  const { input, rows: context, deps, result } = options;
  const stories = await deps.extract(input);
  const { rows, skippedNoLink } = await toRows(stories, { ...context, fetch: deps.fetch });
  result.stories += await deps.store.upsertStories(rows);
  result.skippedNoLink += skippedNoLink;
}

/** Counts one failed document. `finalStatus` relies on one error per failed document. */
function recordFailure(result: SourceResult, label: string, error: unknown): void {
  result.documents += 1;
  result.errors.push(`${label}: ${message(error)}`);
}

/**
 * Runs documents oldest first, counting each and recording failures. Returns the time the bookmark may move
 * to: the last success of the unbroken run from the oldest, and strictly before the first failure's time,
 * because the next run reads only what is strictly after the bookmark.
 */
async function processInOrder<T>(
  documents: T[],
  options: { result: SourceResult; label: (document: T) => string; at: (document: T) => Date; run: (document: T) => Promise<void> },
): Promise<Date | null> {
  const succeeded: Date[] = [];
  let firstFailure: Date | null = null;
  for (const document of [...documents].sort((a, b) => options.at(a).getTime() - options.at(b).getTime())) {
    try {
      await options.run(document);
      options.result.documents += 1;
      if (!firstFailure) succeeded.push(options.at(document));
    } catch (error) {
      recordFailure(options.result, options.label(document), error);
      firstFailure ??= options.at(document);
    }
  }
  const limit = firstFailure;
  return (limit ? succeeded.filter((at) => at < limit) : succeeded).at(-1) ?? null;
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
      await extractAndSave({ input: { sourceDate: newYorkDate(mail.sentAt), text }, rows: { source: source.key }, deps, result });
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

  result.documents += 1;
  // Feed items carry no reliable story date (n8n dated papers by arXiv date, which kept 95 of 319 off the
  // board), so they take the run's date.
  await extractAndSave({
    input: { sourceDate: targetDate, text: feed.text },
    rows: { source: source.key, fixedDay: targetDate },
    deps,
    result,
  });
  await deps.store.writeBookmark(source.key, deps.now);
}

/**
 * Post pages changed on or after `cutoffDay`, newest lastmod first, then in sitemap order, at most
 * `BEEHIIV_PAGE_LIMIT`. `changed` counts all of them.
 */
async function listChangedPosts(
  source: BeehiivSiteSource,
  host: string,
  cutoffDay: string,
  deps: IngestDeps,
): Promise<{ urls: string[]; changed: number }> {
  const response = await fetchPage(new URL("/sitemap.xml", source.siteUrl).href, deps.fetch);
  if (!response.ok) throw new Error(`${source.name} sitemap returned HTTP ${response.status}.`);
  const posts = listSitemapPosts(await response.text()).filter((post) => siteHost(post.url) === host);
  if (posts.length === 0) throw new Error(`${source.name} sitemap lists no posts.`);

  // beehiiv's lastmod is the UTC day (checked 2026-11-10 against posts published at 03:01Z and 14:11Z).
  const changed = posts
    .filter((post): post is SitemapPost & { lastmod: string } => post.lastmod !== null && post.lastmod >= cutoffDay)
    .sort((a, b) => b.lastmod.localeCompare(a.lastmod)); // stable, so ties keep sitemap order
  return { urls: changed.slice(0, BEEHIIV_PAGE_LIMIT).map((post) => post.url), changed: changed.length };
}

type PostPage = { ok: true; url: string; html: string; meta: PostMeta } | { ok: false; url: string; error: string };

async function readPostPage(url: string, deps: IngestDeps): Promise<PostPage> {
  try {
    const response = await fetchPage(url, deps.fetch);
    if (!response.ok) throw new Error(`HTTP ${response.status}.`);
    const html = await response.text();
    const meta = readPostMeta(html);
    // A future date would move the bookmark past every post until then.
    if (meta.publishedAt > deps.now) throw new Error(`datePublished is in the future (${meta.publishedAt.toISOString()}).`);
    return { ok: true, url, html, meta };
  } catch (error) {
    return { ok: false, url, error: message(error) };
  }
}

async function ingestBeehiivSiteSource(source: BeehiivSiteSource, deps: IngestDeps, result: SourceResult): Promise<void> {
  const cutoff = await readCutoff(source.key, deps);
  const host = siteHost(source.siteUrl);
  const cutoffDay = cutoff.toISOString().slice(0, 10);
  const { urls, changed } = await listChangedPosts(source, host, cutoffDay, deps);
  const pages = await mapInBatches(urls, BEEHIIV_PAGE_CONCURRENCY, (url) => readPostPage(url, deps));

  for (const page of pages) if (!page.ok) recordFailure(result, page.url, page.error);
  if (changed > urls.length) {
    // The unread posts count as one failed document, so the status still compares documents with errors.
    recordFailure(result, source.name, `${changed} posts changed since ${cutoffDay}; read ${urls.length}. New posts may be among the unread ones.`);
  }
  // A failed page has no known date, and unread posts may be new, so either keeps the bookmark.
  const nothingFailed = result.errors.length === 0;

  // lastmod is only a day, so a post read earlier today is fetched again and skipped here, with no model call.
  const posts = pages.filter(
    (page): page is Extract<PostPage, { ok: true }> => page.ok && page.meta.free && page.meta.publishedAt > cutoff,
  );
  const advanceTo = await processInOrder(posts, {
    result,
    label: (post) => post.url,
    at: (post) => post.meta.publishedAt,
    run: (post) =>
      extractAndSave({
        input: { sourceDate: newYorkDate(post.meta.publishedAt), text: readPostText(post.html) },
        rows: { source: source.key, ownHost: host },
        deps,
        result,
      }),
  });
  if (advanceTo && nothingFailed) await deps.store.writeBookmark(source.key, advanceTo);
}

function finalStatus(result: SourceResult): SourceStatus {
  if (result.errors.length === 0) return result.documents === 0 ? "no_new" : "ok";
  return result.documents > result.errors.length ? "partial" : "failed";
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
        documents: 0,
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
