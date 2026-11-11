import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import type { WriterInput } from "@/src/pipeline/draft/writer";

/**
 * The writer eval's test set: one writer input per past issue, built by build-dataset.ts from the Neon dev branch
 * (read-only) and kept in evals/data/writer/ (gitignored: it holds story and article text). Only manifest.json,
 * with dates and ids, is committed.
 */

export interface ManifestEntry {
  /** YYYY-MM-DD */
  date: string;
  /** The issue row on the Neon dev branch. */
  issueId: number;
  /**
   * Where the sections come from: `issue_stories` (what the sent email held, by section and position) for a
   * published issue, or `approval_outline` (the board's commit) for a draft-only issue.
   */
  sections: "issue_stories" | "approval_outline";
}

/** How a feature story's article text was found, for the results notes. No text. */
export type ArticleSource = "saved" | `read:${string}` | `unread:${string}`;

export interface WriterCase {
  date: string;
  issueId: number;
  sections: ManifestEntry["sections"];
  input: WriterInput;
  /** Feature stories only, by story id. */
  articleSources: Record<string, ArticleSource>;
}

const HERE = __dirname;
export const MANIFEST_PATH = join(HERE, "manifest.json");
export const DATA_DIR = join(HERE, "..", "data", "writer");

export function caseFile(date: string): string {
  return join(DATA_DIR, `${date}.json`);
}

export function readManifest(): ManifestEntry[] {
  return JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as ManifestEntry[];
}

/** The built cases, in manifest order. Throws with the build command when one is missing. */
export function loadCases(manifest: ManifestEntry[] = readManifest()): WriterCase[] {
  return manifest.map((entry) => {
    const file = caseFile(entry.date);
    if (!existsSync(file)) {
      throw new Error(
        `${file} is missing. Build the test set first: npx vite-node --config vitest.config.ts evals/writer/build-dataset.ts`
      );
    }
    return JSON.parse(readFileSync(file, "utf8")) as WriterCase;
  });
}

/** Counts of article-text sources across the cases, for the results notes. */
export function articleCoverage(cases: WriterCase[]): { features: number; saved: number; read: number; unread: number } {
  const sources = cases.flatMap((item) => Object.values(item.articleSources));
  return {
    features: sources.length,
    saved: sources.filter((source) => source === "saved").length,
    read: sources.filter((source) => source.startsWith("read:")).length,
    unread: sources.filter((source) => source.startsWith("unread:")).length,
  };
}
