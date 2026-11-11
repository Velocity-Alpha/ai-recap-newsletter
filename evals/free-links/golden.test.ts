import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { GOLDEN_PATH, goldenInputFile, goldenProblems, goldenRules, sameNewsDefinitions } from "@/evals/free-links/golden";
import type { FreeLinksGolden } from "@/evals/free-links/score";
import { readStories, type PaywalledStory } from "@/evals/free-links/stories";
import { hashInput, loadGolden, type Golden } from "@/evals/lib/golden";
import { FREE_ARTICLES_ASK, FREE_LINK_EXCLUSIONS, FREE_LINK_PREFERENCE, PAYWALLED_SITE_NAMES } from "@/src/pipeline/free-links/search";
import { MIN_WORDS } from "@/src/pipeline/free-links/sites";

const STORY: PaywalledStory = { id: 1, source: "tldr", day: "2026-10-01", headline: "H", summary: "S", url: "https://www.wsj.com/a" };
const input = { id: 1, headline: "H", summary: "S", url: "https://www.wsj.com/a" };

const golden = (value: FreeLinksGolden, inputHash = hashInput(input)): Golden<FreeLinksGolden> => ({
  about: "test",
  producer: "claude-opus-5-5",
  entries: { "1": { inputHash, date: "2026-11-11", value } },
});

describe("goldenProblems", () => {
  it("accepts a free article on a free site", () => {
    expect(goldenProblems(golden({ free_source_exists: true, urls: ["https://the-decoder.com/a"] }), [STORY])).toEqual([]);
  });

  it("accepts a story with no free source", () => {
    expect(goldenProblems(golden({ free_source_exists: false, urls: [] }), [STORY])).toEqual([]);
  });

  it("names a stale input hash", () => {
    expect(goldenProblems(golden({ free_source_exists: false, urls: [] }, "0000"), [STORY])).toEqual(["1: inputHash is not that of its golden input"]);
  });

  it("names URLs the app's check would drop, and a flag that does not fit the list", () => {
    const urls = ["https://wsj.com/b", "https://x.com/p", "https://www.bloomberg.com/c", "https://ok.com/d"];
    expect(goldenProblems(golden({ free_source_exists: false, urls }), [STORY])).toEqual([
      "1: free_source_exists must be true exactly when urls is not empty",
      "1: more than 3 urls",
      "1: https://wsj.com/b is on the story's own site",
      "1: https://x.com/p is on a skipped site",
      "1: https://www.bloomberg.com/c is on a paywalled site",
    ]);
  });
});

describe("goldenRules", () => {
  it("is built from the search prompt's rules, the judge's definitions and the app's word count", () => {
    const rules = goldenRules(["paywalled.example"]);
    for (const part of [FREE_ARTICLES_ASK, FREE_LINK_PREFERENCE, FREE_LINK_EXCLUSIONS, ...sameNewsDefinitions(), `${MIN_WORDS} words`, "paywalled.example"]) {
      expect(rules).toContain(part);
    }
    expect(sameNewsDefinitions()).toHaveLength(3);
  });
});

describe("golden-todo.md", () => {
  const todo = readFileSync(join(__dirname, "golden-todo.md"), "utf8");

  it("sends the agent to _rules.md and restates none of its rules", () => {
    expect(todo).toContain("_rules.md");
    expect(todo).not.toContain(PAYWALLED_SITE_NAMES.join(", "));
    expect(todo).not.toContain(`${MIN_WORDS} words`);
    for (const line of sameNewsDefinitions()) expect(todo).not.toContain(line);
  });
});

describe("the committed golden file", () => {
  it("has only valid entries for stories of the test set", () => {
    expect(goldenProblems(loadGolden<FreeLinksGolden>(GOLDEN_PATH), readStories())).toEqual([]);
  });
});

describe("goldenInputFile", () => {
  it("holds the story's input and its hash", () => {
    expect(goldenInputFile(STORY)).toEqual({ itemId: "1", inputHash: hashInput(input), input });
  });
});
