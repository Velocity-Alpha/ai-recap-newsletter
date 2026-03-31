export interface Newsletter {
  id: string;
  slug: string;
  title: string;
  excerpt: string;
  issue_date?: string | null;
  published_at: string;
  feature_image_url: string;
}

export type {
  HighlightBullet,
  NewsletterCompactListItemV2,
  NewsletterContentV1,
  NewsletterContentV2,
  NewsletterFeatureItemV2,
  NewsletterIssueApiResponse,
  NewsletterLinkListItemV2,
  NewsletterOverviewV1,
  NewsletterOverviewV2,
  NewsletterSchemaVersion,
  NewsletterStoryV1,
  ParsedNewsletterContent,
  ParsedNewsletterContentV1,
  ParsedNewsletterContentV2,
  ParsedNewsletterIssue,
  ParsedNewsletterIssueBase,
  ParsedNewsletterIssueV1,
  ParsedNewsletterIssueV2,
} from "@/src/features/newsletter/types";
