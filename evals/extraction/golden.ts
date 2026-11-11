import { join } from "node:path";

import type { ExtractionCase } from "@/evals/extraction/dataset";
import { urlsInText } from "@/evals/extraction/score";
import { hashInput, type Golden } from "@/evals/lib/golden";
import {
  EXTRACTION_CATEGORY_RULES,
  EXTRACTION_FILTER_RULES,
  EXTRACTION_IMPORTANCE_RUBRIC,
  EXTRACTION_SUMMARY_RULES,
  EXTRACTION_URL_RULES,
  STORY_CATEGORIES,
  type ExtractionInput,
  type StoryCategory,
} from "@/src/pipeline/ingest/extract";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

/**
 * The golden values of the extraction eval: for each issue, the stories a perfect extraction returns and the
 * items it must leave out, made by Claude Opus from the issue text by the extraction prompt's own rules
 * (golden-todo.md). Labels are our own words and urls are public links, so the file is committed. The rules a
 * golden agent follows are built here from src/pipeline/ingest/extract.ts, never retyped.
 */

export const GOLDEN_PATH = join("evals", "extraction", "golden.json");
export const GOLDEN_INPUTS_DIR = join("evals", "data", "extraction", "golden-inputs");
export const MAX_LABEL_WORDS = 10;

export interface GoldenStory {
  /** At most MAX_LABEL_WORDS words, our own: never the newsletter's headline or text. */
  label: string;
  /** The url the URL rules give: the story's link as it appears in the text, or "". */
  url: string;
  category: StoryCategory;
  /** 1 to 5 by the importance rubric. */
  importance: number;
  /** A list of tools or resources under one heading, url "": the model may return it whole or one story per item. */
  roundup?: boolean;
}

export interface GoldenExcluded {
  label: string;
  /** Which filter rule, in a few words (for example "sponsored", "newsletter promotion"). */
  reason: string;
}

export interface ExtractionGolden {
  stories: GoldenStory[];
  excluded: GoldenExcluded[];
}

/** The input a golden value is made from, and hashed: exactly what the extractor gets. */
export function goldenInput(item: Pick<ExtractionCase, "date" | "text">): ExtractionInput {
  return { sourceDate: item.date, text: item.text };
}

/** One issue's golden input file. */
export interface GoldenInputFile {
  itemId: string;
  /** hashInput(input): copy it to the entry's `inputHash`. */
  inputHash: string;
  source: string;
  /** The issue's public page. */
  issueUrl: string;
  input: ExtractionInput;
}

export function goldenInputFile(item: ExtractionCase): GoldenInputFile {
  const input = goldenInput(item);
  return { itemId: item.id, inputHash: hashInput(input), source: item.source, issueUrl: item.url, input };
}

/** The rules file a golden agent reads first (golden-inputs/_rules.md): the extraction prompt's own parts. */
export function goldenRules(): string {
  return [
    "# Rules for an extraction golden value",
    "",
    "Built by evals/extraction/golden-inputs.ts from the extraction prompt's own parts",
    "(src/pipeline/ingest/extract.ts). Do not change them here.",
    "",
    "## Not qualifying: never extracted (goes in `excluded`)",
    "",
    EXTRACTION_FILTER_RULES,
    "",
    "## Summary rules (for when one story covers several items)",
    "",
    EXTRACTION_SUMMARY_RULES,
    "",
    "## URL rules (the golden `url`)",
    "",
    EXTRACTION_URL_RULES,
    "",
    "## Category (the golden `category`)",
    "",
    EXTRACTION_CATEGORY_RULES,
    "",
    "## Importance (the golden `importance`)",
    "",
    EXTRACTION_IMPORTANCE_RUBRIC,
    "",
  ].join("\n");
}

const words = (text: string) => text.trim().split(/\s+/).filter(Boolean).length;

/** What is wrong with one golden value: its shape, label lengths, and (given the issue text) urls not in the text. */
export function valueProblems(id: string, value: ExtractionGolden, text?: string): string[] {
  if (!Array.isArray(value?.stories) || !Array.isArray(value?.excluded)) return [`${id}: value needs stories and excluded (lists)`];
  const problems: string[] = [];
  const links = text === undefined ? null : urlsInText(text);
  value.stories.forEach((story, index) => {
    const at = `${id} story ${index + 1}`;
    if (typeof story.label !== "string" || words(story.label) === 0 || words(story.label) > MAX_LABEL_WORDS) problems.push(`${at}: label needs 1 to ${MAX_LABEL_WORDS} words`);
    if (!STORY_CATEGORIES.includes(story.category)) problems.push(`${at}: category ${String(story.category)} is not one of STORY_CATEGORIES`);
    if (!Number.isInteger(story.importance) || story.importance < 1 || story.importance > 5) problems.push(`${at}: importance must be an integer 1 to 5`);
    if (typeof story.url !== "string") problems.push(`${at}: url must be a string ("" when the rules say so)`);
    else if (story.url && !/^https?:\/\//.test(story.url)) problems.push(`${at}: url is not an http(s) link`);
    else if (story.url && links && !links.has(cleanStoryUrl(story.url))) problems.push(`${at}: url is not a link in the issue text`);
    if (story.roundup && story.url) problems.push(`${at}: a roundup's url is ""`);
  });
  value.excluded.forEach((item, index) => {
    const at = `${id} excluded ${index + 1}`;
    if (typeof item.label !== "string" || words(item.label) === 0 || words(item.label) > MAX_LABEL_WORDS) problems.push(`${at}: label needs 1 to ${MAX_LABEL_WORDS} words`);
    if (typeof item.reason !== "string" || !item.reason.trim()) problems.push(`${at}: reason is empty`);
  });
  return problems;
}

/**
 * What is wrong with the golden entries: not an issue of the manifest, a bad value, and, for issues whose text is
 * built (`items`), a stale hash or a url that is not in the text.
 */
export function goldenProblems(golden: Golden<ExtractionGolden>, manifestIds: string[], items: ExtractionCase[] = []): string[] {
  const known = new Set(manifestIds);
  const built = new Map(items.map((item) => [item.id, item]));
  const problems: string[] = [];
  for (const [id, entry] of Object.entries(golden.entries)) {
    if (!known.has(id)) {
      problems.push(`${id}: not an issue of the manifest`);
      continue;
    }
    const item = built.get(id);
    if (item && entry.inputHash !== hashInput(goldenInput(item))) problems.push(`${id}: inputHash is not that of its golden input`);
    problems.push(...valueProblems(id, entry.value, item?.text));
  }
  return problems;
}
