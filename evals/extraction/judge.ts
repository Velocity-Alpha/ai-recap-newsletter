import type { ExtractionGolden } from "@/evals/extraction/golden";
import {
  EXTRACTION_FILTER_RULES,
  EXTRACTION_HEADLINE_RULES,
  EXTRACTION_STORY_DETAIL_RULES,
  type ExtractedStory,
} from "@/src/pipeline/ingest/extract";

/**
 * The judge's rubric for one extraction: the newsletter text, the issue's golden list (golden.ts) and the stories
 * the extractor returned. The judge matches each extracted story to the golden list; scoring (score.ts) compares
 * the matched stories' category, importance and url with golden. The judge still grades what golden does not
 * cover: facts the text does not state, and the headline rules. Every rule it applies is imported from the
 * extraction prompt (src/pipeline/ingest/extract.ts), never retyped.
 */

export const STORY_KINDS = ["story", "roundup_item", "filtered", "merged", "fragment", "extra"] as const;
export type StoryKind = (typeof STORY_KINDS)[number];

export interface StoryVerdict {
  /** 1-based, as numbered in the judge input. */
  index: number;
  kind: StoryKind;
  /** The golden story numbers (1-based) it covers: one for story, roundup_item and fragment, two or more for merged. */
  golden: number[];
  /** Facts in the headline, summary or story_detail that the source text does not state. */
  unsupported_facts: number;
  /** The headline rules of the prompt. */
  headline_ok: boolean;
}

export interface ExtractionGrade {
  stories: StoryVerdict[];
}

export const GRADE_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          index: { type: "integer", minimum: 1 },
          kind: { type: "string", enum: [...STORY_KINDS] },
          golden: { type: "array", items: { type: "integer", minimum: 1 } },
          unsupported_facts: { type: "integer", minimum: 0 },
          headline_ok: { type: "boolean" },
        },
        required: ["index", "kind", "golden", "unsupported_facts", "headline_ok"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

export const GRADE_RUBRIC = `You grade a news-story extraction. You get a newsletter issue's text; its golden list, the stories a
perfect extraction returns (numbered from 1, each with a label of a few words and its url) and the items it must
leave out; and the stories an extraction model returned, numbered from 1. Match and count; do not give
impressions. Give one verdict for each extracted story, in order.

## kind and golden

- "story": it is one golden story, and the first extracted story for it. golden: [that number].
- "roundup_item": the golden story is marked roundup (a list under one heading), and this extracted story is one
  item of that list, not the whole list. Every such item gets this kind, with golden: [the roundup's number].
- "merged": it folds two or more golden stories (not a roundup) into one. golden: [each number].
- "fragment": a duplicate of, or a piece of, a golden story that an earlier extracted story already covers.
  golden: [that number].
- "filtered": it is one of the items to leave out, or no news at all. golden: [].
- "extra": a news story that is in the text but neither in the golden list nor among the items to leave out.
  golden: []. Use it only when no golden story or left-out item fits.

Match by the news event, not by wording: the labels are short and in other words. The url helps, but an
extracted story with another url (or none) is still the golden story it reports. Items to leave out follow these
rules of the extraction prompt:

${EXTRACTION_FILTER_RULES}

## unsupported_facts

Count each fact (number, date, name, quote, claim, causal link) in the headline, summary or story_detail that the
newsletter text does not state. Judge against the text, not the golden list. Paraphrase is fine; inference beyond
the text is not. A story with no unsupported facts gets 0. The prompt's story detail rules:

${EXTRACTION_STORY_DETAIL_RULES}

## headline_ok

True when the headline follows the prompt's headline rules:

${EXTRACTION_HEADLINE_RULES}

Give the verdicts for every kind, a "filtered" story too. Return JSON that matches the schema; nothing else.`;

/** The judge's input: the issue text, its golden list, then the extracted stories, numbered from 1. */
export function gradeInput(options: { sourceDate: string; text: string; golden: ExtractionGolden; stories: ExtractedStory[] }): string {
  const golden = options.golden.stories.map((story, index) => ({
    number: index + 1,
    label: story.label,
    url: story.url,
    ...(story.roundup ? { roundup: true } : {}),
  }));
  const stories = options.stories.map((story, index) => ({ number: index + 1, ...story }));
  return [
    `Issue date (the fallback published_at): ${options.sourceDate}`,
    "",
    "# Newsletter text",
    "",
    options.text,
    "",
    `# Golden stories (${golden.length})`,
    "",
    JSON.stringify(golden, null, 1),
    "",
    `# Items to leave out (${options.golden.excluded.length})`,
    "",
    JSON.stringify(options.golden.excluded, null, 1),
    "",
    `# Extracted stories (${stories.length})`,
    "",
    JSON.stringify(stories, null, 1),
  ].join("\n");
}
