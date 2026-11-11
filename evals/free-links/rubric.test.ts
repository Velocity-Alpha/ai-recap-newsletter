import { describe, expect, it } from "vitest";

import { firstWords, sameNewsInput } from "@/evals/free-links/rubric";

describe("firstWords", () => {
  it("cuts a text to its first words, with single spaces", () => {
    expect(firstWords(" one  two three ", 2)).toBe("one two");
  });
});

describe("sameNewsInput", () => {
  it("gives the judge the found link", () => {
    expect(sameNewsInput({ headline: "H", summary: "S" }, { url: "https://e.com" }, "a b c")).toContain("Link: https://e.com");
  });
});
