import { describe, expect, it } from "vitest";

import { firstWords, SAME_NEWS_INSTRUCTIONS, sameNewsInput } from "@/evals/free-links/rubric";
import { PRIMARY_SOURCE_EXAMPLES } from "@/src/pipeline/free-links/search";

describe("SAME_NEWS_INSTRUCTIONS", () => {
  it("names primary sources in the search prompt's words", () => {
    expect(SAME_NEWS_INSTRUCTIONS).toContain(`(${PRIMARY_SOURCE_EXAMPLES})`);
  });
});

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
