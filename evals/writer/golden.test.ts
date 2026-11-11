import { describe, expect, it } from "vitest";

import { goldenFor, hashInput, type Golden } from "@/evals/lib/golden";
import { goldenInputFile, goldenInputOf, goldenProblems, type GoldenIssue } from "@/evals/writer/golden";
import { CASE, GOOD } from "@/evals/writer/testing";
import { WRITTEN_ISSUE_SCHEMA } from "@/src/pipeline/draft/content";
import { buildWriterPrompt, WRITER_INSTRUCTIONS } from "@/src/pipeline/draft/writer";

const fakeGolden = (value: GoldenIssue, inputHash = hashInput(goldenInputOf(CASE))): Golden<GoldenIssue> => ({
  about: "made-up golden issues",
  producer: "claude-opus-5-5",
  entries: { [CASE.date]: { inputHash, date: "2026-11-11", value } },
});

describe("goldenInputOf", () => {
  it("is the writer's input with the eval's notes, as every run gets it", () => {
    expect(goldenInputOf(CASE).sections.headlines[1].note).toBe("Keep the story detail to two sentences.");
  });
});

describe("goldenInputFile", () => {
  const file = goldenInputFile(CASE, "abc");

  it("gives the writer's exact instructions, prompt and schema", () => {
    expect(file).toMatchObject({ itemId: CASE.date, inputHash: "abc", instructions: WRITER_INSTRUCTIONS, schema: WRITTEN_ISSUE_SCHEMA });
    expect(file.prompt).toBe(buildWriterPrompt(goldenInputOf(CASE)));
  });

  it("holds the eval's notes and the article text in the prompt", () => {
    expect(file.prompt).toContain("Write the headline as a question.");
    expect(file.prompt).toContain("Article one.");
  });
});

describe("a fake golden file", () => {
  it("gives the golden issue of a case whose input is unchanged", () => {
    expect(goldenFor(fakeGolden(GOOD), CASE.date, goldenInputOf(CASE))).toEqual(GOOD);
  });

  it("refuses a golden issue made for another input", () => {
    expect(() => goldenFor(fakeGolden(GOOD, "0000000000000000"), CASE.date, goldenInputOf(CASE))).toThrow(/changed since/);
  });
});

describe("goldenProblems", () => {
  it("passes a golden issue that matches the schema and the writer's checks", () => {
    expect(goldenProblems(CASE, GOOD)).toEqual([]);
  });

  it("names a golden issue that is not the writer's schema", () => {
    expect(goldenProblems(CASE, { title: "No sections" })).toEqual([expect.stringMatching(/does not match the schema/)]);
  });

  it("names a golden issue that leaves out a story", () => {
    expect(goldenProblems(CASE, { ...GOOD, quick_hits: [] })).toEqual([expect.stringMatching(/Story 5 .* is missing/)]);
  });
});
