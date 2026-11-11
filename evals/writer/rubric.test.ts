import { describe, expect, it } from "vitest";

import { gradeInput, pairInput } from "@/evals/writer/rubric";
import { CASE, GOOD } from "@/evals/writer/testing";

describe("gradeInput", () => {
  it("puts the source, with article text, before the draft", () => {
    const grade = gradeInput(CASE.input, GOOD);
    expect(grade.indexOf("Article one.")).toBeLessThan(grade.indexOf("DRAFT:"));
  });
});

describe("pairInput", () => {
  it("shows both drafts", () => {
    expect(pairInput(CASE.input, GOOD, GOOD)).toContain("DRAFT B:");
  });

  it("leaves article text out", () => {
    expect(pairInput(CASE.input, GOOD, GOOD)).not.toContain("Article one.");
  });
});
