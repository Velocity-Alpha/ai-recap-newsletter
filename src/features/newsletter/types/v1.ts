export interface NewsletterStoryV1 {
  storyId: number | null;
  title: string;
  summary: string;
  link: string | null;
}

export interface NewsletterOverviewV1 {
  summary: string;
  highlights: string[];
}

export interface NewsletterContentV1 {
  date?: string;
  tools?: Array<{
    link?: string;
    title?: string;
    summary?: string;
    "data-story-id"?: number;
  }>;
  caption?: string;
  imageUrl?: string;
  overview?: {
    summary?: string;
    highlights?: string[];
  };
  research?: Array<{
    link?: string;
    title?: string;
    summary?: string;
    "data-story-id"?: number;
  }>;
  quickHits?: Array<{
    link?: string;
    title?: string;
    summary?: string;
    "data-story-id"?: number;
  }>;
  topStories?: Array<{
    link?: string;
    title?: string;
    summary?: string;
    "data-story-id"?: number;
  }>;
  "data-issue-id"?: number;
}

export interface ParsedNewsletterContentV1 {
  schemaVersion: 1;
  overview: NewsletterOverviewV1 | null;
  topStories: NewsletterStoryV1[];
  research: NewsletterStoryV1[];
  tools: NewsletterStoryV1[];
  quickHits: NewsletterStoryV1[];
}
