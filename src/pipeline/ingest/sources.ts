/**
 * The 7 story sources (n8n's `1. Fetch Stories`, minus Aloa, which stopped sending on 2026-04-27).
 * `key` is both the `stories.source` value and the `scraper_bookmarks` key. n8n mixed these up for
 * The Signal (saved as `tldr_ai`, bookmark never advanced) and TLDR (read The Signal's bookmark).
 */

import type { Weekday } from "@/src/pipeline/checks/schedule";

const EVERY_WEEKDAY: readonly Weekday[] = ["Mon", "Tue", "Wed", "Thu", "Fri"];

type SourceBase = {
  key: string;
  name: string;
  /**
   * The weekdays the 09:55 ingest run gets stories from this source, so the `source-empty` check warns
   * when it gets none. This is the run day, not the send day: an email sent after 09:55 lands in the next
   * weekday's run. Set from the inbox (Gmail sources) and `stories` (feeds), 2026-07-14 to 2026-11-10: a
   * day is listed when stories landed on it in at least 80% of those 17 weeks. Leave out a day the source
   * often skips.
   */
  expectedOn: readonly Weekday[];
};

export type GmailSource = SourceBase & {
  kind: "gmail";
  sender: string;
  /** Which body part the model reads. `html` is converted to text with links. */
  body: "text" | "html";
  /** Click-tracking links to swap for their targets before extraction. */
  trackingLinks?: RegExp;
};

export type FeedSource = SourceBase & { kind: "product_hunt" | "hugging_face" };

export type StorySource = GmailSource | FeedSource;

export const STORY_SOURCES: StorySource[] = [
  {
    key: "rundown_ai",
    name: "The Rundown",
    kind: "gmail",
    sender: "news@daily.therundown.ai",
    body: "text",
    expectedOn: EVERY_WEEKDAY,
  },
  {
    key: "ai_breakfast",
    name: "AI Breakfast",
    kind: "gmail",
    sender: "aibreakfast@mail.beehiiv.com",
    body: "text",
    // Sends Mon, Wed and Fri, more than half the time after 09:55, so no run day is reliable
    // (best: Monday, 13 of 17 weeks).
    expectedOn: [],
  },
  {
    key: "the_signal",
    name: "The Signal",
    kind: "gmail",
    sender: "thesignal@substack.com",
    body: "text",
    // Sends on Sundays.
    expectedOn: ["Mon"],
    trackingLinks: /https:\/\/substack\.com\/redirect\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?j=[A-Za-z0-9_.-]+/gi,
  },
  {
    key: "tldr",
    name: "TLDR",
    kind: "gmail",
    sender: "dan@tldrnewsletter.com",
    body: "text",
    // Monday's email usually arrives after 09:55 and lands on Tuesday (in the Monday run 6 of 17 weeks).
    expectedOn: ["Tue", "Wed", "Thu", "Fri"],
    trackingLinks: /https:\/\/links\.tldrnewsletter\.com\/[A-Za-z0-9]+/gi,
  },
  {
    key: "alphasignal",
    name: "AlphaSignal",
    kind: "gmail",
    sender: "news@alphasignal.ai",
    body: "html",
    expectedOn: EVERY_WEEKDAY,
    trackingLinks: /https:\/\/app\.alphasignal\.ai\/c\?[^"'<> \t\r\n]+/gi,
  },
  { key: "product_hunt_ai", name: "Product Hunt", kind: "product_hunt", expectedOn: EVERY_WEEKDAY },
  { key: "huggingface", name: "Hugging Face", kind: "hugging_face", expectedOn: EVERY_WEEKDAY },
];
