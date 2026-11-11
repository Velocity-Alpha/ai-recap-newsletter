/**
 * The judge's rubric for one kept link: does the article report the same news as the story? (GLOSSARY: Free link)
 * What counts as a primary source is the search prompt's own words (search.ts), imported, never retyped.
 */
import { PRIMARY_SOURCE_EXAMPLES } from "@/src/pipeline/free-links/search";

/** Words of the article the judge sees: enough to tell the news, and a cap on the judge's cost. */
export const ARTICLE_WORDS_FOR_JUDGE = 700;

export const SAME_NEWS_INSTRUCTIONS = `You check a link a newsletter wants to use in place of a paywalled one. You get the newsletter's story (headline and summary) and the start of the linked article.

Answer "same" when the article reports the same news event as the story: the same announcement, deal, release, filing, or incident, so a reader who clicks gets the story's facts. A primary source of that event (${PRIMARY_SOURCE_EXAMPLES}) counts as "same".
Answer "related" when it is about the same company or topic but a different event, an earlier or later step, or mainly opinion or background.
Answer "different" when it is about something else, or the page is not an article (an index page, a login wall, an error page).

Answer in JSON only.`;

export const SAME_NEWS_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["same_news", "reason"],
  properties: {
    same_news: { type: "string", enum: ["same", "related", "different"] },
    reason: { type: "string", description: "One short sentence." },
  },
};

export function firstWords(text: string, count: number): string {
  return text.trim().split(/\s+/).slice(0, count).join(" ");
}

export function sameNewsInput(story: { headline: string; summary: string }, link: { url: string }, articleText: string): string {
  return `Story headline: ${story.headline}\nStory summary: ${story.summary}\n\nLink: ${link.url}\nArticle (first ${ARTICLE_WORDS_FOR_JUDGE} words):\n${firstWords(articleText, ARTICLE_WORDS_FOR_JUDGE)}`;
}
