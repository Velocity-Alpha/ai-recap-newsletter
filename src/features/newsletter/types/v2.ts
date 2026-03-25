import type { HighlightBullet } from "./shared";

export interface NewsletterOverviewV2 {
  summary: string;
}

export interface NewsletterFeatureItemV2 {
  storyId: number | null;
  url: string | null;
  headline: string;
  storyDetail: string;
  bullets: HighlightBullet[] | null;
}

export interface NewsletterLinkListItemV2 {
  storyId: number | null;
  url: string | null;
  linkText: string;
  detail: string;
}

export interface NewsletterCompactListItemV2 {
  storyId: number | null;
  url: string | null;
  linkText: string;
  text: string;
}

export interface NewsletterContentV2 {
  schemaVersion: 2;
  featured_image_url?: string;
  title?: string;
  date?: string;
  issue_id?: number;
  overview?: {
    summary?: string;
  };
  headlines?: Array<{
    story_id?: number;
    url?: string;
    headline?: string;
    story_detail?: string;
    bullets?: Array<{
      before?: string;
      highlight?: string;
      after?: string;
    }> | null;
  }>;
  research_and_analysis?: Array<{
    story_id?: number;
    url?: string;
    headline?: string;
    story_detail?: string;
    bullets?: Array<{
      before?: string;
      highlight?: string;
      after?: string;
    }> | null;
  }>;
  tools?: Array<{
    story_id?: number;
    url?: string;
    link_text?: string;
    detail?: string;
  }>;
  quick_hits?: Array<{
    story_id?: number;
    url?: string;
    link_text?: string;
    text?: string;
  }>;
  sections?: {
    headlines?: NewsletterContentV2["headlines"];
    research_and_analysis?: NewsletterContentV2["research_and_analysis"];
    tools?: NewsletterContentV2["tools"];
    quick_hits?: NewsletterContentV2["quick_hits"];
  };
}

export interface ParsedNewsletterContentV2 {
  schemaVersion: 2;
  overview: NewsletterOverviewV2 | null;
  headlines: NewsletterFeatureItemV2[];
  researchAndAnalysis: NewsletterFeatureItemV2[];
  tools: NewsletterLinkListItemV2[];
  quickHits: NewsletterCompactListItemV2[];
}
