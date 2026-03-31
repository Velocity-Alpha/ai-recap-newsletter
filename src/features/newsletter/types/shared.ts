export type NewsletterSchemaVersion = 1 | 2;

export interface NewsletterIssueApiResponse {
  id?: number | null;
  slug?: string | null;
  title: string;
  excerpt: string;
  feature_image_url?: string | null;
  issue_date?: string | null;
  published_at?: string | null;
  content_json: unknown;
}

export interface HighlightBullet {
  before: string;
  highlight: string;
  after: string;
}

export interface ParsedNewsletterIssueBase {
  schemaVersion: NewsletterSchemaVersion;
  id: number | null;
  slug: string | null;
  title: string;
  excerpt: string;
  issueDate: string | null;
  publishedAt: string | null;
  displayDate: string | null;
  imageUrl: string | null;
  description: string;
}
