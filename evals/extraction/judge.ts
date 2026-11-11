import { STORY_CATEGORIES, type ExtractedStory } from "@/src/pipeline/ingest/extract";

/**
 * The judge's rubric for one extraction: the newsletter text and the stories the extractor returned. It
 * restates the rules of the extraction prompt (src/pipeline/ingest/extract.ts) that decide quality, and asks
 * for counts and per-story verdicts, so the scores are numbers.
 */

export const STORY_KINDS = ["story", "filtered", "merged", "fragment"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export interface StoryVerdict {
  /** 1-based, as numbered in the judge input. */
  index: number;
  kind: StoryKind;
  /** Facts in the headline, summary or story_detail that the source text does not state. */
  unsupported_facts: number;
  /** The category the first matching rule gives. */
  expected_category: (typeof STORY_CATEGORIES)[number];
  /** Headline rules: close to the original or a tight news headline, no How/Why/What start, Title Case. */
  headline_ok: boolean;
  /** url rule: the story's direct source link, or "" when it has several links or none. */
  url_ok: boolean;
  /** 1 to 5 by the importance rubric. */
  expected_importance: number;
}

export interface ExtractionGrade {
  /** Qualifying news stories in the text: what a perfect extraction returns. */
  qualifying_in_text: number;
  /** Qualifying stories that no extracted story covers. */
  missed: number;
  /** A few words each, for the missed stories. Not saved: it can quote the newsletter. */
  missed_labels: string[];
  stories: StoryVerdict[];
}

export const GRADE_SCHEMA = {
  type: "object",
  properties: {
    qualifying_in_text: { type: "integer", minimum: 0 },
    missed: { type: "integer", minimum: 0 },
    missed_labels: { type: "array", items: { type: "string" } },
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 1 },
          kind: { type: "string", enum: [...STORY_KINDS] },
          unsupported_facts: { type: "integer", minimum: 0 },
          expected_category: { type: "string", enum: [...STORY_CATEGORIES] },
          headline_ok: { type: "boolean" },
          url_ok: { type: "boolean" },
          expected_importance: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["index", "kind", "unsupported_facts", "expected_category", "headline_ok", "url_ok", "expected_importance"],
        additionalProperties: false,
      },
    },
  },
  required: ["qualifying_in_text", "missed", "missed_labels", "stories"],
  additionalProperties: false,
};

export const GRADE_RUBRIC = `You grade a news-story extraction. You get a newsletter issue's text and the stories an extraction model
returned from it, numbered from 1. Grade strictly against the rules below, which are the extraction model's own
rules. Count; do not give impressions.

## What a qualifying story is

A qualifying story is a distinct news item in the text: its own headline, or its own sentence or paragraph with a
named event, usually with a link. Items in a "quick links", "everything else", or similar list each count as one
qualifying story. A list of tools or resources under one heading (for example "trending tools") is one roundup:
the model may return it as one story with url "" and the links in the summary, or as one story per item. Both are
right; count the roundup's items as qualifying only if the model split it, and as one qualifying story otherwise.

These are NOT qualifying, and must not be extracted:
- Sponsored content: marked "Presented By", "Together with", "SPONSOR", "(Sponsor)", "In partnership with",
  or plainly an advertisement; sponsored events or webinars; tools or links marked with an asterisk (*).
- Lead magnets: demos, ebook downloads, free guides, whitepapers, waitlists with no news.
- Newsletter self-promotion, referral links, subscribe or "how to use this newsletter" content, polls, jobs,
  courses or workshops sold by the newsletter.
- Recurring sections with no news story ("tip of the day", "workflow of the week", a prompt, a tutorial).
- Negative news: a story whose subject is a negative effect or consequence of AI (for example AI taking
  people's jobs).
- The issue's own intro, table of contents, or sign-off.

## Recall

qualifying_in_text: how many qualifying stories the text holds. missed: how many of them no extracted story
covers. missed_labels: a few words of your own for each missed story (max 8 words each).

## Per extracted story (one verdict for each number, in order)

kind:
- "story": a qualifying story, extracted as one story.
- "filtered": not a qualifying story (any item of the NOT list above, or no news at all).
- "merged": two or more distinct qualifying stories (not a roundup) folded into one.
- "fragment": a duplicate of, or a piece of, another extracted story.

unsupported_facts: count each fact (number, date, name, quote, claim, causal link) in the headline, summary or
story_detail that the text does not state. Paraphrase is fine; inference beyond the text is not. A story with
no unsupported facts gets 0.

expected_category: apply the category rules in order and take the FIRST that matches:
1. Launches: a genuinely new product, model, or market entry, live and usable today, that did not exist before
   (not a feature added to a shipping product).
2. Research: a paper, benchmark, technical finding, or dataset is the primary subject; source is a lab,
   university, or technical publication.
3. Funding: a funding round, acquisition, valuation milestone, or IPO filing.
4. Industry: a strategic move not covered above: shutdowns, partnerships, leadership changes or hires, reversals,
   competitive moves, strategy announcements, controversies, leaks, disputes; also announced but not shipped
   features.
5. Policy: a government body, regulator, or court has taken or announced formal action on AI.
6. Analysis: opinion, commentary, forecasts, explainers, interviews, with no underlying news event.
7. Tools: a developer tool, library, API, or open-source repo; or a feature update to an existing product that
   is live today.
8. Community: user stories, social moments, surveys, grassroots usage.
9. Culture: broader societal impact without a specific policy action.

headline_ok: true when the headline stays close to the original headline or, if there is none, is a tight news
headline of at most 12 words; does not start with "How", "Why" or "What"; and is in Title Case (brand
casing such as OpenAI, iOS, xAI is fine).

url_ok: true when url is the direct link to the story's original source as given in the text (the newsletter's
own permalink only if there is no other), or "" when the story is a roundup with several links or the text gives
no link for it. False when the url is not in the text, points to a different story, or is a sponsor link.

expected_importance: 1 to 5 by this rubric (first level that fully matches). Tier 1: OpenAI, Anthropic,
Google/DeepMind, Meta AI, NVIDIA, Microsoft, Apple, Amazon/AWS, xAI.
- 5: a Tier 1 company ships a new standalone model or product line or enters a new market today; a
  field-resetting benchmark or event; a Tier 1 dramatic pivot, shutdown or reversal; formal government action
  affecting a major company or the industry broadly; a major safety incident or scandal at a Tier 1 company.
- 4: a Tier 1 company announces future plans for a new model, product or market; a Tier 1 meaningful capability
  expansion (not a UI or isolated feature); a well-known AI-native company (Cursor, Mistral, Perplexity, Cohere,
  Harvey, Hugging Face, Runway, ElevenLabs, Stability AI, Groq) ships something notable; funding or acquisition
  over $500M; a well-known AI-native company kills or pivots a significant product; government action against
  one company; a notable public dispute, leak or controversy from a named major player.
- 3: a known AI-native company announces something not yet shipped; research with clear practical
  implications; funding of $50M to $500M; a policy development with a named enforcement mechanism.
- 2: an incremental update or isolated new feature, a minor model release, a small round, tooling from an
  unknown company, or analysis with no news anchor.
- 1: opinion, evergreen explainer, job move, minor integration, event recap, or no clear news event.

Give the verdicts for a "filtered" story too. Return JSON that matches the schema; nothing else.`;

/** The judge's input: the issue text, then the extracted stories, numbered from 1. */
export function gradeInput(options: { sourceDate: string; text: string; stories: ExtractedStory[] }): string {
  const stories = options.stories.map((story, index) => ({ number: index + 1, ...story }));
  return [
    `Issue date (the fallback published_at): ${options.sourceDate}`,
    "",
    "# Newsletter text",
    "",
    options.text,
    "",
    `# Extracted stories (${stories.length})`,
    "",
    JSON.stringify(stories, null, 1),
  ].join("\n");
}
