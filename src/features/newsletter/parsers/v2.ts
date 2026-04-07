import type {
  HighlightBullet,
  NewsletterCompactListItemV2,
  NewsletterContentV2,
  NewsletterFeatureItemV2,
  NewsletterIssueApiResponse,
  NewsletterLinkListItemV2,
  ParsedNewsletterContentV2,
  ParsedNewsletterIssueV2,
} from "@/features/newsletter/types";
import { createIssueBase, getNestedRecord, getNumber, getString, isRecord } from "./shared";

const EMPTY_CONTENT: ParsedNewsletterContentV2 = {
  schemaVersion: 2,
  overview: null,
  headlines: [],
  researchAndAnalysis: [],
  tools: [],
  quickHits: [],
};

function getHighlightBullets(value: unknown): HighlightBullet[] | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const bullets = value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const highlight = getString(item.highlight);
    if (!highlight) {
      return [];
    }

    return [
      {
        before: getString(item.before) ?? "",
        highlight,
        after: getString(item.after) ?? "",
      },
    ];
  });

  return bullets.length > 0 ? bullets : null;
}

function getFeatureList(value: unknown): NewsletterFeatureItemV2[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const headline = getString(item.headline);
    if (!headline) {
      return [];
    }

    return [
      {
        storyId: getNumber(item.story_id),
        url: getString(item.url),
        headline,
        storyDetail: getString(item.story_detail) ?? "",
        bullets: getHighlightBullets(item.bullets),
      },
    ];
  });
}

function getLinkList(value: unknown): NewsletterLinkListItemV2[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const linkText = getString(item.link_text);
    if (!linkText) {
      return [];
    }

    return [
      {
        storyId: getNumber(item.story_id),
        url: getString(item.url),
        linkText,
        detail: getString(item.detail) ?? "",
      },
    ];
  });
}

function getCompactList(value: unknown): NewsletterCompactListItemV2[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((item) => {
    if (!isRecord(item)) {
      return [];
    }

    const linkText = getString(item.link_text);
    if (!linkText) {
      return [];
    }

    return [
      {
        storyId: getNumber(item.story_id),
        url: getString(item.url),
        linkText,
        text: getString(item.text) ?? "",
      },
    ];
  });
}

export function parseNewsletterContentV2(contentJson: unknown): ParsedNewsletterContentV2 {
  if (!isRecord(contentJson)) {
    return EMPTY_CONTENT;
  }

  const content = contentJson as unknown as NewsletterContentV2;
  const sections = getNestedRecord(contentJson, "sections");

  return {
    schemaVersion: 2,
    overview: content.overview?.summary
      ? { summary: content.overview.summary.trim() }
      : null,
    headlines: getFeatureList(sections?.headlines ?? content.headlines),
    researchAndAnalysis: getFeatureList(sections?.research_and_analysis ?? content.research_and_analysis),
    tools: getLinkList(sections?.tools ?? content.tools),
    quickHits: getCompactList(sections?.quick_hits ?? content.quick_hits),
  };
}

export function parseNewsletterIssueV2(issue: NewsletterIssueApiResponse): ParsedNewsletterIssueV2 {
  const content = parseNewsletterContentV2(issue.content_json);
  const contentRecord = isRecord(issue.content_json) ? (issue.content_json as unknown as NewsletterContentV2) : null;

  return {
    ...createIssueBase(issue, {
      schemaVersion: 2,
      title: getString(contentRecord?.title) ?? issue.title,
      description: content.overview?.summary || issue.excerpt,
      imageUrl: getString(contentRecord?.featured_image_url),
    }),
    content,
  };
}
