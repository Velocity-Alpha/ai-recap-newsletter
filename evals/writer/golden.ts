import { join } from "node:path";

import { DATA_DIR, type WriterCase } from "@/evals/writer/dataset";
import { writerInputOf } from "@/evals/writer/notes";
import { parseWrittenIssue, WRITTEN_ISSUE_SCHEMA, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { findContentProblems } from "@/src/pipeline/draft/validate";
import { buildWriterPrompt, WRITER_INSTRUCTIONS, type WriterInput } from "@/src/pipeline/draft/writer";

/**
 * The golden issue of a case: a reference written issue in the writer's own schema (WRITTEN_ISSUE_SCHEMA), written
 * by Claude Opus from the writer's exact input, following the writer's own instructions. It is made from article
 * text, so it lives next to the cases in evals/data/writer/ (gitignored). evals/writer/golden-todo.md says how to
 * write one. Its entry's inputHash is hashInput(goldenInputOf(item)).
 */
export type GoldenIssue = WrittenIssueContent;

export const GOLDEN_PATH = join(DATA_DIR, "golden.json");
export const GOLDEN_INPUTS_DIR = join(DATA_DIR, "golden-inputs");
/** Where golden agents write one entry per case, before golden-inputs.ts --merge gathers them into GOLDEN_PATH. */
export const GOLDEN_ENTRIES_DIR = join(DATA_DIR, "golden-entries");

/** What the golden issue of a case is made from, and what its inputHash covers: the writer's input, with the eval's notes. */
export function goldenInputOf(item: WriterCase): WriterInput {
  return writerInputOf(item);
}

/** What a golden writer reads for one case: the writer's exact instructions, prompt and output schema. */
export interface GoldenInputFile {
  itemId: string;
  /** Copy into the golden entry as is. */
  inputHash: string;
  /** The writer's system instructions. */
  instructions: string;
  /** The writer's prompt for this case: the stories, notes and article text (buildWriterPrompt). */
  prompt: string;
  /** The JSON schema the golden issue must match. */
  schema: typeof WRITTEN_ISSUE_SCHEMA;
}

export function goldenInputFile(item: WriterCase, inputHash: string): GoldenInputFile {
  return {
    itemId: item.date,
    inputHash,
    instructions: WRITER_INSTRUCTIONS,
    prompt: buildWriterPrompt(goldenInputOf(item)),
    schema: WRITTEN_ISSUE_SCHEMA,
  };
}

/** Why a golden issue is not usable: it does not parse as the writer's schema, or fails the writer's checks. */
export function goldenProblems(item: WriterCase, value: unknown): string[] {
  let content: WrittenIssueContent;
  try {
    content = parseWrittenIssue(JSON.stringify(value));
  } catch (error) {
    return [error instanceof Error ? error.message : String(error)];
  }
  return findContentProblems(content, goldenInputOf(item).sections);
}
