import type { NewsletterIssueApiResponse } from "@/src/features/newsletter/types";
import type { Newsletter } from "@/src/types/newsletter.types";
import { getPool } from "@/src/server/db";

export interface NewsletterListPagination {
  currentPage: number;
  totalPages: number;
  totalCount: number;
  limit: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface NewsletterListPage {
  data: Newsletter[];
  pagination: NewsletterListPagination;
}

export interface PublishedNewsletterEntry {
  id: string;
  slug: string | null;
  published_at: string;
  issue_date: string | null;
}

export interface TickerStory {
  headline: string;
  day?: string;
  category?: string;
  createdAt?: string;
}

export interface TickerStats {
  stories: number;
  tools: number;
  papers: number;
}

export interface TickerFeed {
  data: TickerStory[];
  stats: TickerStats;
  count: number;
}

function serializeDateValue(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (typeof value === "string") {
    return value;
  }

  return String(value);
}

function normalizePositiveInteger(value: number, fallback: number) {
  if (!Number.isFinite(value)) {
    return fallback;
  }

  const normalizedValue = Math.trunc(value);
  return normalizedValue >= 1 ? normalizedValue : fallback;
}

function normalizeListLimit(limit: number) {
  return Math.min(100, normalizePositiveInteger(limit, 6));
}

function normalizeListPage(page: number) {
  return normalizePositiveInteger(page, 1);
}

function mapNewsletterRow(row: Record<string, unknown>): Newsletter {
  return {
    id: String(row.id),
    slug: row.slug ? String(row.slug) : "",
    title: String(row.title),
    excerpt: String(row.excerpt ?? ""),
    issue_date: serializeDateValue(row.issue_date),
    published_at: serializeDateValue(row.published_at) ?? "",
    feature_image_url: row.feature_image_url ? String(row.feature_image_url) : null,
  };
}

function mapIssueRow(row: Record<string, unknown>): NewsletterIssueApiResponse {
  return {
    id: row.id == null ? null : Number(row.id),
    slug: row.slug ? String(row.slug) : null,
    title: String(row.title),
    excerpt: row.excerpt == null ? "" : String(row.excerpt),
    feature_image_url: row.feature_image_url ? String(row.feature_image_url) : null,
    content_json: row.content_json,
    issue_date: serializeDateValue(row.issue_date),
    published_at: serializeDateValue(row.published_at),
  };
}

export async function fetchNewsletterListPage(page: number, limit: number): Promise<NewsletterListPage> {
  const validPage = normalizeListPage(page);
  const validLimit = normalizeListLimit(limit);
  const offset = (validPage - 1) * validLimit;

  const result = await getPool().query(
    `WITH filtered AS (
       SELECT
         id,
         slug,
         title,
         excerpt,
         feature_image_url,
         issue_date,
         published_at,
         created_at
       FROM newsletter.issues
       WHERE content_json IS NOT NULL
         AND published_at IS NOT NULL
     ),
     total AS (
       SELECT COUNT(*)::int AS total_count
       FROM filtered
     )
     SELECT
       paged.id,
       paged.slug,
       paged.title,
       paged.excerpt,
       paged.feature_image_url,
       paged.issue_date,
       paged.published_at,
       paged.created_at,
       total.total_count
     FROM total
     LEFT JOIN LATERAL (
       SELECT *
       FROM filtered
       ORDER BY COALESCE(issue_date, published_at::date) DESC, published_at DESC
       LIMIT $1 OFFSET $2
     ) paged ON true;`,
    [validLimit, offset],
  );

  const rows = result.rows || [];
  const totalCount = Number(rows[0]?.total_count ?? 0);
  const totalPages = Math.ceil(totalCount / validLimit);
  const data = rows
    .filter((row) => row.id !== null)
    .map((row) => mapNewsletterRow(row));

  return {
    data,
    pagination: {
      currentPage: validPage,
      totalPages,
      totalCount,
      limit: validLimit,
      hasNextPage: validPage < totalPages,
      hasPreviousPage: validPage > 1,
    },
  };
}

export async function fetchPublishedNewsletterEntries(): Promise<PublishedNewsletterEntry[]> {
  const result = await getPool().query(
    `SELECT
       id,
       slug,
       published_at,
       issue_date
     FROM newsletter.issues
     WHERE content_json IS NOT NULL
       AND published_at IS NOT NULL
     ORDER BY COALESCE(issue_date, published_at::date) DESC, published_at DESC`,
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    slug: row.slug ? String(row.slug) : null,
    published_at: serializeDateValue(row.published_at) ?? "",
    issue_date: serializeDateValue(row.issue_date),
  }));
}

export async function fetchNewsletterIssueApiResponseById(id: number): Promise<NewsletterIssueApiResponse | null> {
  const result = await getPool().query(
    `SELECT
       id,
       slug,
       title,
       excerpt,
       feature_image_url,
       content_json,
       issue_date,
       published_at,
       created_at
     FROM newsletter.issues
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapIssueRow(result.rows[0]);
}

export async function fetchNewsletterIssueApiResponseBySlug(slug: string): Promise<NewsletterIssueApiResponse | null> {
  const result = await getPool().query(
    `SELECT
       id,
       slug,
       title,
       excerpt,
       feature_image_url,
       content_json,
       issue_date,
       published_at,
       created_at
     FROM newsletter.issues
     WHERE slug = $1`,
    [slug],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapIssueRow(result.rows[0]);
}

export async function fetchTickerFeed(): Promise<TickerFeed> {
  const [statsResult, storiesResult] = await Promise.all([
    getPool().query(
      `SELECT
         COUNT(*) FILTER (WHERE category ILIKE '%research%' OR category ILIKE '%paper%')::int AS papers,
         COUNT(*) FILTER (WHERE category ILIKE '%tool%')::int AS tools,
         COUNT(*) FILTER (
           WHERE category NOT ILIKE '%research%'
             AND category NOT ILIKE '%paper%'
             AND category NOT ILIKE '%tool%'
              OR category IS NULL
         )::int AS stories
       FROM newsletter.stories
       WHERE day >= CURRENT_DATE - INTERVAL '7 days';`,
    ),
    getPool().query(
      `SELECT headline, day, category, randomized_created_at AS "createdAt"
       FROM (
         SELECT DISTINCT ON (TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')))
           TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')) AS headline,
           day,
           category,
           "createdAt" + (random() * 24 - 12) * interval '1 hour' AS randomized_created_at
         FROM newsletter.stories
         WHERE day >= CURRENT_DATE - INTERVAL '7 days'
           AND LENGTH(headline) <= 80
           AND headline NOT ILIKE '%tldr%'
           AND headline NOT ILIKE '%rundown%'
           AND headline NOT ILIKE '%morning%'
         ORDER BY TRIM(REGEXP_REPLACE(headline, '\\(\\d+\\s*minute\\s*read\\)', '', 'gi')), day DESC, "createdAt" DESC
       ) sub
       ORDER BY randomized_created_at DESC
       LIMIT 20;`,
    ),
  ]);

  const statsRow = statsResult.rows[0] ?? {};
  const data = (storiesResult.rows || []) as TickerStory[];

  return {
    data,
    stats: {
      stories: Number(statsRow.stories ?? 0),
      tools: Number(statsRow.tools ?? 0),
      papers: Number(statsRow.papers ?? 0),
    },
    count: data.length,
  };
}
