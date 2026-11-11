import { describe, expect, it } from "vitest";

import { withEvalNotes } from "@/evals/writer/notes";
import { CASE, story } from "@/evals/writer/testing";

describe("withEvalNotes", () => {
  const owned = () => ({ ...CASE.input, sections: { ...CASE.input.sections, quickHits: [story(5, "Owner note.")] } });

  it("adds the eval's notes to stories with no note", () => {
    const { input, noted } = withEvalNotes(owned());
    expect(noted.map((entry) => entry.storyId)).toEqual([2, 3]);
    expect(input.sections.headlines[1].note).toBe("Keep the story detail to two sentences.");
  });

  it("keeps an owner's note", () => {
    expect(withEvalNotes(owned()).input.sections.quickHits[0].note).toBe("Owner note.");
  });

  it("leaves the input it is given unchanged", () => {
    const input = owned();
    withEvalNotes(input);
    expect(input.sections.headlines[1].note).toBe("");
  });
});
