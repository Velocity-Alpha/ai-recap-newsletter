import type { ParsedNewsletterIssueBase } from "./shared";
import type { ParsedNewsletterContentV1 } from "./v1";
import type { ParsedNewsletterContentV2 } from "./v2";

export type { NewsletterListItem } from "./list";
export type { HighlightBullet, NewsletterIssueApiResponse, NewsletterSchemaVersion, ParsedNewsletterIssueBase } from "./shared";
export type { NewsletterContentV1, NewsletterOverviewV1, NewsletterStoryV1, ParsedNewsletterContentV1 } from "./v1";
export type {
  NewsletterCompactListItemV2,
  NewsletterContentV2,
  NewsletterFeatureItemV2,
  NewsletterLinkListItemV2,
  NewsletterOverviewV2,
  ParsedNewsletterContentV2,
} from "./v2";

export interface ParsedNewsletterIssueV1 extends ParsedNewsletterIssueBase {
  schemaVersion: 1;
  content: ParsedNewsletterContentV1;
}

export interface ParsedNewsletterIssueV2 extends ParsedNewsletterIssueBase {
  schemaVersion: 2;
  content: ParsedNewsletterContentV2;
}

export type ParsedNewsletterContent = ParsedNewsletterContentV1 | ParsedNewsletterContentV2;
export type ParsedNewsletterIssue = ParsedNewsletterIssueV1 | ParsedNewsletterIssueV2;
