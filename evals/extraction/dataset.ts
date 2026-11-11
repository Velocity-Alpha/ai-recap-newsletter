import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "node-html-parser";

import { readPostText } from "@/src/pipeline/ingest/beehiiv-site";
import { htmlToText } from "@/src/pipeline/ingest/email-text";

/**
 * The extraction test set: public web versions of past issues (manifest.json), turned into text with the
 * repo's own helpers, as close as the web allows to what production feeds the extractor. The text is
 * third-party, so it lives in evals/data/extraction/ (gitignored). Only the manifest is committed.
 */

/** How a web page becomes extractor text. */
export type IssueFormat = "tldr_web" | "rundown_web" | "beehiiv" | "substack";

export interface ManifestIssue {
  id: string;
  /** The `stories.source` key in production. */
  source: string;
  /** YYYY-MM-DD, the issue's New York send date: the extractor's fallback date. */
  date: string;
  format: IssueFormat;
  url: string;
  /** The Neon dev rows that came from this issue, or null when the source was not ingested then. */
  reference: { source: string; days: string[] } | null;
}

/** One built issue, in evals/data/extraction/dataset.json. */
export interface ExtractionCase extends ManifestIssue {
  text: string;
  /** Story rows on the Neon dev branch for the reference, or null when there is none or no DB was read. */
  referenceCount: number | null;
  /** The cleaned story urls of those rows, for overlap. */
  referenceUrls: string[];
}

export const MANIFEST_PATH = join(__dirname, "manifest.json");
export const DATA_DIR = join(__dirname, "..", "data", "extraction");
export const DATASET_PATH = join(DATA_DIR, "dataset.json");

export function readManifest(): ManifestIssue[] {
  return (JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { issues: ManifestIssue[] }).issues;
}

export function readDataset(): ExtractionCase[] {
  if (!existsSync(DATASET_PATH)) {
    throw new Error(`No dataset at ${DATASET_PATH}. Build it first: npm run eval:build -- evals/extraction/build-dataset.ts`);
  }
  return JSON.parse(readFileSync(DATASET_PATH, "utf8")) as ExtractionCase[];
}

function textOf(html: string, selector: string, what: string): string {
  const element = parse(html, { comment: false }).querySelector(selector);
  if (!element) throw new Error(`${what} page has no ${selector} element.`);
  const text = htmlToText(element.outerHTML);
  if (!text) throw new Error(`${what} page has no text.`);
  return text;
}

/**
 * The extractor text of one issue page. beehiiv pages go through production's own reader (In the World of
 * AI is read this way in production). The others are email sources in production; their web pages go
 * through `htmlToText`, the converter production uses for HTML email.
 */
export function issueText(format: IssueFormat, html: string): string {
  switch (format) {
    case "beehiiv":
      return readPostText(html);
    case "tldr_web":
      return textOf(html, "div.content-center", "TLDR");
    case "rundown_web":
      return textOf(html, "div.rendered-post", "Rundown");
    case "substack":
      return textOf(html, "div.available-content", "Substack");
    default: {
      const unknown: never = format;
      throw new Error(`Unknown issue format: ${String(unknown)}`);
    }
  }
}
