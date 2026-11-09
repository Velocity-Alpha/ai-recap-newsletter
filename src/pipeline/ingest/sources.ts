/**
 * The 7 story sources (n8n's `1. Fetch Stories`, minus Aloa, which stopped sending on 2026-04-27).
 * `key` is both the `stories.source` value and the `scraper_bookmarks` key. n8n mixed these up for
 * The Signal (saved as `tldr_ai`, bookmark never advanced) and TLDR (read The Signal's bookmark).
 */

export type GmailSource = {
  key: string;
  name: string;
  kind: "gmail";
  sender: string;
  /** Which body part the model reads. `html` is converted to text with links. */
  body: "text" | "html";
  /** Click-tracking links to swap for their targets before extraction. */
  trackingLinks?: RegExp;
};

export type FeedSource = { key: string; name: string; kind: "product_hunt" | "hugging_face" };

export type StorySource = GmailSource | FeedSource;

export const STORY_SOURCES: StorySource[] = [
  { key: "rundown_ai", name: "The Rundown", kind: "gmail", sender: "news@daily.therundown.ai", body: "text" },
  { key: "ai_breakfast", name: "AI Breakfast", kind: "gmail", sender: "aibreakfast@mail.beehiiv.com", body: "text" },
  {
    key: "the_signal",
    name: "The Signal",
    kind: "gmail",
    sender: "thesignal@substack.com",
    body: "text",
    trackingLinks: /https:\/\/substack\.com\/redirect\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\?j=[A-Za-z0-9_.-]+/gi,
  },
  {
    key: "tldr",
    name: "TLDR",
    kind: "gmail",
    sender: "dan@tldrnewsletter.com",
    body: "text",
    trackingLinks: /https:\/\/links\.tldrnewsletter\.com\/[A-Za-z0-9]+/gi,
  },
  {
    key: "alphasignal",
    name: "AlphaSignal",
    kind: "gmail",
    sender: "news@alphasignal.ai",
    body: "html",
    trackingLinks: /https:\/\/app\.alphasignal\.ai\/c\?[^"'<> \t\r\n]+/gi,
  },
  { key: "product_hunt_ai", name: "Product Hunt", kind: "product_hunt" },
  { key: "huggingface", name: "Hugging Face", kind: "hugging_face" },
];
