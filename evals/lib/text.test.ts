import { describe, expect, it } from "vitest";

import { countSentences, countWords } from "@/evals/lib/text";

describe("countSentences", () => {
  it("splits at an end of sentence before a capital, digit or quote", () => {
    expect(countSentences('One. Two! 3 is next? "Four."')).toBe(4);
  });

  it("does not split a decimal", () => {
    expect(countSentences("It costs $3.50 a month. It ships today!")).toBe(2);
  });

  it("does not split an abbreviation", () => {
    expect(countSentences("It costs more, e.g. tax. Then stop.")).toBe(2);
  });

  it("counts text with no end mark as one sentence", () => {
    expect(countSentences("One sentence only")).toBe(1);
  });

  it("is 0 for blank text", () => {
    expect(countSentences("  ")).toBe(0);
  });
});

describe("countWords", () => {
  it("counts words with a letter or digit", () => {
    expect(countWords("A model — 2 times faster")).toBe(5);
  });
});
