import type { NewsletterIssueApiResponse } from "@/src/features/newsletter/types";
import type { Newsletter } from "@/src/types/newsletter.types";
import { prisma } from "@/src/server/prisma";

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

type NewsletterListRow = {
  id: bigint | number | string | null;
  slug: string | null;
  title: string;
  excerpt: string | null;
  feature_image_url: string | null;
  issue_date: Date | string | null;
  published_at: Date | string | null;
  total_count: number | bigint | string | null;
};

type PublishedNewsletterRow = {
  id: bigint | number | string;
  slug: string | null;
  published_at: Date | string | null;
  issue_date: Date | string | null;
};

type TickerStatsRow = {
  stories: number | bigint | string | null;
  tools: number | bigint | string | null;
  papers: number | bigint | string | null;
};

type TickerStoryRow = {
  headline: string;
  day: Date | string | null;
  category: string | null;
  createdAt: Date | string | null;
};

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

function mapNewsletterRow(row: NewsletterListRow): Newsletter {
  return {
    id: String(row.id),
    slug: row.slug ?? "",
    title: row.title,
    excerpt: row.excerpt ?? "",
    issue_date: serializeDateValue(row.issue_date),
    published_at: serializeDateValue(row.published_at) ?? "",
    feature_image_url: row.feature_image_url ?? null,
  };
}

function mapIssueRecord(record: {
  id: bigint;
  slug: string | null;
  title: string;
  excerpt: string | null;
  featureImageUrl: string | null;
  contentJson: unknown;
  issueDate: Date | null;
  publishedAt: Date | null;
}): NewsletterIssueApiResponse {
  return {
    id: Number(record.id),
    slug: record.slug,
    title: record.title,
    excerpt: record.excerpt ?? "",
    feature_image_url: record.featureImageUrl,
    content_json: record.contentJson,
    issue_date: serializeDateValue(record.issueDate),
    published_at: serializeDateValue(record.publishedAt),
  };
}

export async function fetchNewsletterListPage(page: number, limit: number): Promise<NewsletterListPage> {
  const validPage = normalizeListPage(page);
  const validLimit = normalizeListLimit(limit);
  const offset = (validPage - 1) * validLimit;

  const rows = await prisma.$queryRaw<NewsletterListRow[]>`
    WITH filtered AS (
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
      total.total_count
    FROM total
    LEFT JOIN LATERAL (
      SELECT *
      FROM filtered
      ORDER BY COALESCE(issue_date, published_at::date) DESC, published_at DESC
      LIMIT ${validLimit} OFFSET ${offset}
    ) paged ON true;
  `;

  const totalCount = Number(rows[0]?.total_count ?? 0);
  const totalPages = Math.ceil(totalCount / validLimit);

  return {
    data: rows.filter((row) => row.id !== null).map(mapNewsletterRow),
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
  const rows = await prisma.$queryRaw<PublishedNewsletterRow[]>`
    SELECT
      id,
      slug,
      published_at,
      issue_date
    FROM newsletter.issues
    WHERE content_json IS NOT NULL
      AND published_at IS NOT NULL
    ORDER BY COALESCE(issue_date, published_at::date) DESC, published_at DESC
  `;

  return rows.map((row) => ({
    id: String(row.id),
    slug: row.slug,
    published_at: serializeDateValue(row.published_at) ?? "",
    issue_date: serializeDateValue(row.issue_date),
  }));
}

export async function fetchNewsletterIssueApiResponseById(id: number): Promise<NewsletterIssueApiResponse | null> {
  const record = await prisma.issue.findUnique({
    where: { id: BigInt(id) },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      featureImageUrl: true,
      contentJson: true,
      issueDate: true,
      publishedAt: true,
    },
  });

  return record ? mapIssueRecord(record) : null;
}

export async function fetchNewsletterIssueApiResponseBySlug(slug: string): Promise<NewsletterIssueApiResponse | null> {
  const record = await prisma.issue.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      title: true,
      excerpt: true,
      featureImageUrl: true,
      contentJson: true,
      issueDate: true,
      publishedAt: true,
    },
  });

  return record ? mapIssueRecord(record) : null;
}

export async function fetchTickerFeed(): Promise<TickerFeed> {
  const [statsRows, storyRows] = await Promise.all([
    prisma.$queryRaw<TickerStatsRow[]>`
      SELECT
        COUNT(*) FILTER (WHERE category ILIKE '%research%' OR category ILIKE '%paper%')::int AS papers,
        COUNT(*) FILTER (WHERE category ILIKE '%tool%')::int AS tools,
        COUNT(*) FILTER (
          WHERE (
            category NOT ILIKE '%research%'
            AND category NOT ILIKE '%paper%'
            AND category NOT ILIKE '%tool%'
          )
          OR category IS NULL
        )::int AS stories
      FROM newsletter.stories
      WHERE day >= CURRENT_DATE - INTERVAL '7 days';
    `,
    prisma.$queryRaw<TickerStoryRow[]>`
      SELECT headline, day, category, randomized_created_at AS "createdAt"
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
      LIMIT 20;
    `,
  ]);

  const stats = statsRows[0] ?? { stories: 0, tools: 0, papers: 0 };
  const data = storyRows.map((row) => ({
    headline: row.headline,
    day: serializeDateValue(row.day) ?? undefined,
    category: row.category ?? undefined,
    createdAt: serializeDateValue(row.createdAt) ?? undefined,
  }));

  return {
    data,
    stats: {
      stories: Number(stats.stories ?? 0),
      tools: Number(stats.tools ?? 0),
      papers: Number(stats.papers ?? 0),
    },
    count: data.length,
  };
}
