import { describe, expect, it, vi } from "vitest";

import type { JudgeRequest } from "@/evals/lib/judge";
import { draftFirst, gradeWriter } from "@/evals/writer/grade";
import type { IssueGrade } from "@/evals/writer/rubric";
import type { WriterRun } from "@/evals/writer/score";
import { CASE, GOOD } from "@/evals/writer/testing";
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";

const ISSUE: IssueGrade = { stories: [], intro_unsupported_claims: 0, editorial_quality: 4, quality_reason: "Crisp." };
const GOLDEN: WrittenIssueContent = { ...GOOD, title: "Second lab ships rival model" };
const RUN: WriterRun = { first: GOOD, firstProblems: [], finalProblems: [] };

/** A fake judge: the issue grade, and the pairwise winner it is given (or a throw). */
function fakeJudge(winner: "A" | "B" | "tie" | Error) {
  return vi.fn(async (request: JudgeRequest): Promise<unknown> => {
    if (request.name === "issue_grade") return ISSUE;
    if (winner instanceof Error) throw winner;
    return { winner, reason: "Sharper." };
  });
}

const pairRequest = (judge: ReturnType<typeof fakeJudge>) => judge.mock.calls.map(([request]) => request).find((request) => request.name !== "issue_grade");

describe("gradeWriter", () => {
  it("grades faithfulness and compares the draft with the golden issue", async () => {
    const judge = fakeJudge("A");
    const grade = await gradeWriter(CASE, RUN, { judge: judge as never, golden: GOLDEN, draftFirst: true });
    expect(grade).toEqual({ issue: ISSUE, vsGolden: { result: "win", draftFirst: true } });
  });

  it("puts the golden issue first when the coin says so, and scores a pick of it as a loss", async () => {
    const judge = fakeJudge("A");
    const grade = await gradeWriter(CASE, RUN, { judge: judge as never, golden: GOLDEN, draftFirst: false });
    const input = pairRequest(judge)?.input ?? "";
    expect(input.indexOf("Second lab ships rival model")).toBeLessThan(input.indexOf("DRAFT B:"));
    expect(grade.vsGolden).toEqual({ result: "loss", draftFirst: false });
  });

  it("keeps the faithfulness grade when the pairwise judge fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const grade = await gradeWriter(CASE, RUN, { judge: fakeJudge(new Error("down")) as never, golden: GOLDEN, draftFirst: true });
    expect(grade).toEqual({ issue: ISSUE, vsGolden: null });
  });

  it("does not tell the judge which draft is golden", async () => {
    const judge = fakeJudge("tie");
    await gradeWriter(CASE, RUN, { judge: judge as never, golden: GOLDEN, draftFirst: true });
    expect(`${pairRequest(judge)?.instructions}${pairRequest(judge)?.input}`).not.toMatch(/golden/i);
  });
});

describe("draftFirst", () => {
  it("is the same for the same issue, repeat and config", () => {
    expect(draftFirst("2026-11-05", 0, "gpt-6-luna|high")).toBe(draftFirst("2026-11-05", 0, "gpt-6-luna|high"));
  });

  it("puts the draft first in about half of the questions", () => {
    const firsts = Array.from({ length: 200 }, (_, index) => draftFirst(`issue-${index}`, 0, "gpt-6-luna|high")).filter(Boolean).length;
    expect(firsts).toBeGreaterThan(70);
    expect(firsts).toBeLessThan(130);
  });
});
