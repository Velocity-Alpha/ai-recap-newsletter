import { describe, expect, it } from "vitest";

import { GRADE_INSTRUCTIONS, gradeInput, PAIR_INSTRUCTIONS, pairInput } from "@/evals/writer/rubric";
import { CASE, GOOD } from "@/evals/writer/testing";
import {
  buildWriterPrompt,
  WRITER_BULLET_SOURCE_RULES,
  WRITER_EDITORIAL_GOALS,
  WRITER_GROUNDING_RULES,
  WRITER_INSTRUCTIONS,
  WRITER_NOTE_RULE,
  WRITER_OVERVIEW_RULES,
  WRITER_RUN_NOTE_RULE,
  WRITER_UNTRUSTED_ARTICLE_RULE,
  WRITER_WRITING_CONSTRAINTS,
} from "@/src/pipeline/draft/writer";

describe("the rubrics quote the writer's own rules", () => {
  // Each part the rubrics quote must be text the writer is sent, so a rubric cannot hold a rule the writer never saw.
  const sent = `${WRITER_INSTRUCTIONS}\n${buildWriterPrompt(CASE.input)}`;
  const quoted = {
    grade: [
      WRITER_UNTRUSTED_ARTICLE_RULE,
      WRITER_GROUNDING_RULES,
      WRITER_BULLET_SOURCE_RULES,
      WRITER_NOTE_RULE,
      WRITER_RUN_NOTE_RULE,
      WRITER_EDITORIAL_GOALS,
      WRITER_WRITING_CONSTRAINTS,
      WRITER_OVERVIEW_RULES,
    ],
    pair: [WRITER_GROUNDING_RULES, WRITER_NOTE_RULE, WRITER_EDITORIAL_GOALS, WRITER_WRITING_CONSTRAINTS],
  };

  it("sends every quoted part to the writer", () => {
    for (const part of [...quoted.grade, ...quoted.pair]) expect(sent).toContain(part);
  });

  it("puts every part in the grade rubric", () => {
    for (const part of quoted.grade) expect(GRADE_INSTRUCTIONS).toContain(part);
  });

  it("puts every part in the pairwise rubric", () => {
    for (const part of quoted.pair) expect(PAIR_INSTRUCTIONS).toContain(part);
  });

  it("holds no writer rule line that is not in the writer's prompt", () => {
    // A rubric line that reads like a writer rule ("- " and a capital or a quote) must be one the writer is sent,
    // word for word. The rubric's own field lines ("- distinct_from_detail: ...") start lower case.
    const ruleLines = [GRADE_INSTRUCTIONS, PAIR_INSTRUCTIONS].flatMap((text) => text.split("\n")).filter((line) => /^- [A-Z"]/.test(line));
    expect(ruleLines.length).toBeGreaterThan(10);
    for (const line of ruleLines) expect(sent).toContain(line);
  });
});

describe("gradeInput", () => {
  it("puts the source, with article text, before the draft", () => {
    const grade = gradeInput(CASE.input, GOOD);
    expect(grade.indexOf("Article one.")).toBeLessThan(grade.indexOf("DRAFT:"));
  });

  it("gives the writer's exact prompt as the source", () => {
    expect(gradeInput(CASE.input, GOOD)).toContain(buildWriterPrompt(CASE.input));
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
