import { describe, expect, it } from "vitest";

import { countSentences, countWords } from "@/evals/lib/text";

describe("countSentences", () => {
  it("splits at an end of sentence before a capital, digit or quote", () => {
    expect(countSentences("One. Two! 3 is next? \"Four.\"")).toBe(4);
    expect(countSentences("It costs $2.5 and e.g. more. Then stop.")).toBe(2);
    expect(countSentences("  ")).toBe(0);
  });
});

describe("countWords", () => {
  it("counts words with a letter or digit", () => {
    expect(countWords("A model — 2 times faster")).toBe(5);
  });
});
