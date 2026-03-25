import type { NewsletterContentV1, NewsletterIssueApiResponse, ParsedNewsletterContentV1, ParsedNewsletterIssueV1, NewsletterOverviewV1, NewsletterStoryV1 } from "@/src/features/newsletter/types";
import { createIssueBase, getNumber, getString, getStringArray, isRecord } from "./shared";

const EMPTY_CONTENT: ParsedNewsletterContentV1 = {
  schemaVersion: 1,
  overview: null,
  topStories: [],
  research: [],
  tools: [],
  quickHits: [],
};

function getOverview(value: unknown): NewsletterOverviewV1 | null {
  if (!isRecord(value)) {
    return null;
  }

  const summary = getString(value.summary) ?? "";
  const highlights = getStringArray(value.highlights);

  if (!summary && highlights.length === 0) {
    return null;
  }

  return {
    summary,
    highlights,
  };
}

function getStoryList(value: unknown): NewsletterStoryV1[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const title = getString(item.title);
    if (!title) {
      return [];
    }

    return [
      {
        storyId: getNumber(item["data-story-id"]),
        title,
        summary: getString(item.summary) ?? "",
        link: getString(item.link),
      },
    ];
  });
}

export function parseNewsletterContentV1(contentJson: unknown): ParsedNewsletterContentV1 {
  if (!isRecord(contentJson)) {
    return EMPTY_CONTENT;
  }

  const content = contentJson as NewsletterContentV1;

  return {
    schemaVersion: 1,
    overview: getOverview(content.overview),
    topStories: getStoryList(content.topStories),
    research: getStoryList(content.research),
    tools: getStoryList(content.tools),
    quickHits: getStoryList(content.quickHits),
  };
}

export function parseNewsletterIssueV1(issue: NewsletterIssueApiResponse): ParsedNewsletterIssueV1 {
  const content = parseNewsletterContentV1(issue.content_json);
  const contentRecord = isRecord(issue.content_json) ? (issue.content_json as NewsletterContentV1) : null;

  return {
    ...createIssueBase(issue, {
      schemaVersion: 1,
      title: getString(contentRecord?.caption) ?? issue.title,
      description: content.overview?.summary || issue.excerpt,
      imageUrl: getString(contentRecord?.imageUrl),
    }),
    content,
  };
}
