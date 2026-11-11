import OpenAI from "openai";

import { siteOf } from "@/src/pipeline/free-links/sites";

/**
 * The web search for free links (#59): one OpenAI request with the web search tool, for a story whose link is
 * paywalled and that has no free link among our own stories. The request and the prompt are those of issue #59;
 * the recorded answers in `__fixtures__/search-answers.json` were made with them, so keep them equal.
 * Measured on 10 stories: 2 to 9 searches for each request, 11 to 62 seconds, about 4 cents.
 */

export const SEARCH_MODEL = "gpt-6-luna";
const REQUEST_OPTIONS = { timeout: 120_000, maxRetries: 1 };

export interface SearchStory {
  headline: string | null;
  summary: string | null;
  /** The paywalled link. */
  url: string;
}

/** A link the search returned. Not checked yet: check-links.ts reads it. */
export interface FoundLink {
  url: string;
  title: string;
}

export interface SearchRequest {
  model: string;
  tools: { type: "web_search" }[];
  input: string;
}

/** The part of the OpenAI client the search uses, so tests can replace it. */
export interface SearchClient {
  responses: { create(request: SearchRequest, options: { timeout: number; maxRetries: number }): Promise<{ output_text?: string }> };
}

export interface SearchDeps {
  client?: SearchClient;
  apiKey?: string;
  /** Gets one line when the answer cannot be used. */
  log?: (message: string) => void;
}

export function buildSearchPrompt(story: SearchStory): string {
  return `A newsletter wants to link to this news story, but its link (${siteOf(story.url) ?? "unknown site"}) is paywalled.

Headline: ${story.headline ?? ""}
Summary: ${story.summary ?? ""}

Search the web and find up to 3 free-to-read articles that report this same news. Prefer original reporting, large news sites, and primary sources (a company post, a filing, a court document). Do not return paywalled sites (WSJ, FT, Bloomberg, NYT, The Information, Reuters, CNBC Pro), social media posts, aggregators, or short rewrites. Answer with JSON only: {"links":[{"url":"...","title":"...","site":"..."}]}. Use an empty list when you find none.`;
}

/**
 * The links of the model's answer: the text from the first `{` to the last `}`, read as JSON. Only http and https
 * links are kept. Null when the text does not parse or has no `links` list.
 */
export function parseSearchAnswer(text: string): FoundLink[] | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end < start) return null;
  let answer: unknown;
  try {
    answer = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const links = (answer as { links?: unknown } | null)?.links;
  if (!Array.isArray(links)) return null;
  return links.flatMap((link: { url?: unknown; title?: unknown } | null) => {
    const url = typeof link?.url === "string" ? link.url.trim() : "";
    return siteOf(url) ? [{ url, title: typeof link?.title === "string" ? link.title.trim() : "" }] : [];
  });
}

/** Asks the web search for free articles that report the story's news. An answer that cannot be used is no links. */
export async function searchFreeLinks(story: SearchStory, deps: SearchDeps = {}): Promise<FoundLink[]> {
  const client = deps.client ?? (new OpenAI({ apiKey: deps.apiKey ?? process.env.OPENAI_API_KEY }) as unknown as SearchClient);
  const request: SearchRequest = { model: SEARCH_MODEL, tools: [{ type: "web_search" }], input: buildSearchPrompt(story) };
  const response = await client.responses.create(request, REQUEST_OPTIONS);
  const text = response.output_text ?? "";
  const links = parseSearchAnswer(text);
  if (links === null) {
    (deps.log ?? console.warn)(`[free-links] The web search answer has no links list: ${text.slice(0, 300)}`);
    return [];
  }
  return links;
}
