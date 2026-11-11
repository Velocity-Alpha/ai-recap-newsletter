import { createHash } from "node:crypto";

import type { Judge } from "@/evals/lib/judge";
import type { WriterCase } from "@/evals/writer/dataset";
import type { GoldenIssue } from "@/evals/writer/golden";
import { writerInputOf } from "@/evals/writer/notes";
import {
  GRADE_INSTRUCTIONS,
  GRADE_SCHEMA,
  gradeInput,
  PAIR_INSTRUCTIONS,
  PAIR_SCHEMA,
  pairInput,
  type IssueGrade,
  type PairGrade,
} from "@/evals/writer/rubric";
import { pairResult, type WriterGrade, type WriterRun } from "@/evals/writer/score";

/**
 * Whether the run's draft is DRAFT A against the golden issue: a coin fixed by issue, repeat and config, so the
 * order is random across runs but a rerun asks the same question.
 */
export function draftFirst(itemId: string, repeat: number, config: string): boolean {
  return createHash("sha256").update(`${itemId}|${repeat}|${config}`).digest()[0] % 2 === 0;
}

/**
 * The judge's two grades of a run's first draft: faithfulness against the writer's exact input, and the pairwise
 * verdict against the golden issue (blind, in the coin's order). A failed pairwise judge leaves `vsGolden` null.
 */
export async function gradeWriter(
  item: WriterCase,
  output: WriterRun,
  options: { judge: Judge; golden: GoldenIssue; draftFirst: boolean }
): Promise<WriterGrade> {
  const input = writerInputOf(item);
  const [a, b] = options.draftFirst ? [output.first, options.golden] : [options.golden, output.first];
  const [issue, vsGolden] = await Promise.all([
    options.judge<IssueGrade>({ name: "issue_grade", instructions: GRADE_INSTRUCTIONS, input: gradeInput(input, output.first), schema: GRADE_SCHEMA }),
    options
      .judge<PairGrade>({ name: "golden_preference", instructions: PAIR_INSTRUCTIONS, input: pairInput(input, a, b), schema: PAIR_SCHEMA })
      .then((verdict) => ({ result: pairResult(verdict.winner, options.draftFirst), draftFirst: options.draftFirst }))
      .catch((error: unknown) => {
        console.warn(`[writer] ${item.date}: the pairwise judge failed: ${error instanceof Error ? error.message : String(error)}`);
        return null;
      }),
  ]);
  return { issue, vsGolden };
}
