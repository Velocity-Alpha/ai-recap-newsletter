import type { Outcome } from "@/evals/lib/sweep";
import { NO_USAGE } from "@/evals/lib/usage";

/** A full Outcome for score tests: give the fields the test is about. A grade makes it "graded". */
export function outcomeOf<Item, Output, Grade = never>(
  fields: Pick<Outcome<Item, Output, Grade>, "item"> & Partial<Outcome<Item, Output, Grade>>
): Outcome<Item, Output, Grade> {
  return {
    id: "1",
    repeat: 0,
    latencyMs: 1,
    output: null,
    error: null,
    usage: NO_USAGE,
    callMs: [],
    grade: null,
    gradeStatus: fields.grade === undefined || fields.grade === null ? "none" : "graded",
    gradeError: null,
    ...fields,
  };
}
