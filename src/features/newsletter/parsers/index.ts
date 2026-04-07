import type { NewsletterIssueApiResponse, ParsedNewsletterContent, ParsedNewsletterIssue } from "@/features/newsletter/types";
import { getNewsletterContentImageUrl, getNewsletterSchemaVersion } from "./shared";
import { parseNewsletterContentV1, parseNewsletterIssueV1 } from "./v1";
import { parseNewsletterContentV2, parseNewsletterIssueV2 } from "./v2";

export { getNewsletterContentImageUrl, getNewsletterSchemaVersion };

export function parseNewsletterContent(contentJson: unknown): ParsedNewsletterContent {
  return getNewsletterSchemaVersion(contentJson) === 2
    ? parseNewsletterContentV2(contentJson)
    : parseNewsletterContentV1(contentJson);
}

export function parseNewsletterIssue(issue: NewsletterIssueApiResponse): ParsedNewsletterIssue {
  return getNewsletterSchemaVersion(issue.content_json) === 2
    ? parseNewsletterIssueV2(issue)
    : parseNewsletterIssueV1(issue);
}
