import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { hashInput, loadGolden, type Golden } from "@/evals/lib/golden";
import { GOLDEN_PATH, goldenInputFile, goldenProblems, goldenRules } from "@/evals/repeats/golden";
import { labelRulesList, PAIR_LABEL_RULES } from "@/evals/repeats/labels";
import { goldenPairInput, newPairItems, opusLabelledPairs, type NewPairItem, type PairGolden } from "@/evals/repeats/pairs";

const ITEM: NewPairItem = {
  id: "2-1",
  pair: { newer: 2, older: 1, picked: "similarity", similarity: 0.7, rank: 1, same: 0.1, news: 0.9 },
  newer: { id: 2, headline: "New", summary: "Newer story." },
  older: { id: 1, headline: "Old", summary: "Older story." },
};

const golden = (value: PairGolden, inputHash = hashInput(goldenPairInput(ITEM))): Golden<PairGolden> => ({
  about: "test",
  producer: "claude-opus-5-5",
  entries: { "2-1": { inputHash, date: "2026-11-11", value } },
});

describe("goldenProblems", () => {
  it("accepts a label with a confidence and a reason", () => {
    expect(goldenProblems(golden({ label: "follow_up", confidence: "low", why: "Launch, then its results." }), [ITEM])).toEqual([]);
  });

  it("names a stale input hash and a value of the wrong shape", () => {
    const wrong = golden({ label: "repeat", confidence: "sure", why: " " } as unknown as PairGolden, "0000");
    expect(goldenProblems(wrong, [ITEM])).toEqual([
      "2-1: inputHash is not that of its golden input",
      "2-1: label must be one of same, follow_up, different",
      "2-1: confidence must be one of high, medium, low",
      "2-1: why must be a short sentence",
    ]);
  });

  it("names an entry for a pair that is not new", () => {
    expect(goldenProblems(golden({ label: "same", confidence: "high", why: "x" }), [])).toEqual(["2-1: not a new pair"]);
  });
});

describe("opusLabelledPairs", () => {
  it("labels the new pairs that have a golden value, and says the label is Opus's", () => {
    const pairs = opusLabelledPairs(golden({ label: "different", confidence: "medium", why: "x" }), [ITEM, { ...ITEM, id: "3-1" }]);
    expect(pairs).toEqual([{ id: "2-1", label: "different", confidence: "medium", labelSource: "opus", newer: ITEM.newer, older: ITEM.older }]);
  });

  it("refuses a golden value whose stories changed since", () => {
    expect(() => opusLabelledPairs(golden({ label: "same", confidence: "high", why: "x" }, "0000"), [ITEM])).toThrow(/changed since/);
  });
});

describe("goldenRules", () => {
  it("holds every labelling rule", () => {
    for (const rule of Object.values(PAIR_LABEL_RULES)) expect(goldenRules()).toContain(rule);
  });
});

describe("golden-todo.md", () => {
  it("sends the agent to _rules.md and restates none of the rules", () => {
    const todo = readFileSync(join(__dirname, "golden-todo.md"), "utf8");
    expect(todo).toContain("_rules.md");
    for (const rule of Object.values(PAIR_LABEL_RULES)) expect(todo.replace(/\s+/g, " ")).not.toContain(rule.slice(0, 60));
  });
});

describe("the committed golden file", () => {
  it("has only valid entries for new pairs", () => {
    expect(goldenProblems(loadGolden<PairGolden>(GOLDEN_PATH), newPairItems())).toEqual([]);
  });
});

describe("goldenInputFile", () => {
  it("holds the pair's two stories and their hash", () => {
    const input = { newer: ITEM.newer, older: ITEM.older };
    expect(goldenInputFile(ITEM)).toEqual({ itemId: "2-1", inputHash: hashInput(input), input });
  });
});

it("labelRulesList gives one line per label", () => {
  expect(labelRulesList().split("\n")).toHaveLength(3);
});
