import { getTrimmedImageUrl } from "@/features/newsletter/media";
import type { NewsletterIssueApiResponse, NewsletterSchemaVersion, ParsedNewsletterIssueBase } from "@/features/newsletter/types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function getString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const trimmedValue = value.trim();
  return trimmedValue ? trimmedValue : null;
}

export function getNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function getStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function getNestedRecord(source: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = source[key];
  return isRecord(value) ? value : null;
}

export function getNewsletterSchemaVersion(contentJson: unknown): NewsletterSchemaVersion {
  if (!isRecord(contentJson)) {
    return 1;
  }

  return contentJson.schemaVersion === 2 ? 2 : 1;
}

export function getNewsletterContentImageUrl(contentJson: unknown): string | null {
  if (!isRecord(contentJson)) {
    return null;
  }

  const hero = getNestedRecord(contentJson, "hero");
  const image = getNestedRecord(contentJson, "image");

  return (
    getTrimmedImageUrl(contentJson.featured_image_url as string | null | undefined) ??
    getTrimmedImageUrl(contentJson.imageUrl as string | null | undefined) ??
    getTrimmedImageUrl(contentJson.heroImageUrl as string | null | undefined) ??
    getTrimmedImageUrl(hero?.imageUrl as string | null | undefined) ??
    getTrimmedImageUrl(image?.url as string | null | undefined)
  );
}

export function createIssueBase<TSchemaVersion extends NewsletterSchemaVersion>(
  issue: NewsletterIssueApiResponse,
  options: {
    schemaVersion: TSchemaVersion;
    title?: string | null;
    description: string;
    imageUrl?: string | null;
  }
): ParsedNewsletterIssueBase & { schemaVersion: TSchemaVersion } {
  const issueDate = issue.issue_date ?? null;
  const publishedAt = issue.published_at ?? null;

  return {
    schemaVersion: options.schemaVersion,
    id: typeof issue.id === "number" ? issue.id : null,
    slug: typeof issue.slug === "string" ? issue.slug : null,
    title: options.title ?? issue.title,
    excerpt: issue.excerpt,
    issueDate,
    publishedAt,
    displayDate: issueDate ?? publishedAt,
    imageUrl:
      getTrimmedImageUrl(issue.feature_image_url) ??
      options.imageUrl ??
      getNewsletterContentImageUrl(issue.content_json),
    description: options.description,
  };
}
