import { existsSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { DATASET_PATH, readDataset, readManifest, type ExtractionCase } from "@/evals/extraction/dataset";
import { GOLDEN_PATH, goldenInput, goldenInputFile, goldenProblems, goldenRules, type ExtractionGolden } from "@/evals/extraction/golden";
import { hashInput, loadGolden, type Golden } from "@/evals/lib/golden";
import {
  buildExtractionPrompt,
  EXTRACTION_CATEGORY_RULES,
  EXTRACTION_FILTER_RULES,
  EXTRACTION_IMPORTANCE_RUBRIC,
  EXTRACTION_SUMMARY_RULES,
  EXTRACTION_URL_RULES,
} from "@/src/pipeline/ingest/extract";

// Made-up issue: no third-party text in tests.
const ITEM: ExtractionCase = {
  id: "fake-2026-10-01",
  source: "fake",
  date: "2026-10-01",
  format: "beehiiv",
  url: "https://news.example/p/issue",
  reference: null,
  text: "[Acme Ships Model](https://acme.example/model) Acme released a model.\nSponsored: buy our course.",
  referenceCount: null,
  referenceUrls: [],
};

const VALUE: ExtractionGolden = {
  stories: [{ label: "Acme ships a model", url: "https://acme.example/model", category: "Launches", importance: 3 }],
  excluded: [{ label: "Course ad", reason: "sponsored" }],
};

const goldenOf = (value: unknown, inputHash = hashInput(goldenInput(ITEM))): Golden<ExtractionGolden> => ({
  about: "test",
  producer: "claude-opus-5-5",
  entries: { [ITEM.id]: { inputHash, date: "2026-11-11", value: value as ExtractionGolden } },
});

describe("goldenInputFile", () => {
  it("holds exactly the extractor's input and its hash", () => {
    const file = goldenInputFile(ITEM);
    expect(file.input).toEqual({ sourceDate: "2026-10-01", text: ITEM.text });
    expect(file.inputHash).toBe(hashInput({ sourceDate: "2026-10-01", text: ITEM.text }));
  });
});

describe("goldenRules", () => {
  it("is built from the extraction prompt's own parts, which the app sends", () => {
    const rules = goldenRules();
    const prompt = buildExtractionPrompt({ sourceDate: "2026-10-01", text: "" });
    for (const part of [EXTRACTION_FILTER_RULES, EXTRACTION_SUMMARY_RULES, EXTRACTION_URL_RULES, EXTRACTION_CATEGORY_RULES, EXTRACTION_IMPORTANCE_RUBRIC]) {
      expect(rules).toContain(part);
      expect(prompt).toContain(part);
    }
  });
});

describe("goldenProblems", () => {
  it("passes a good value", () => {
    expect(goldenProblems(goldenOf(VALUE), [ITEM.id], [ITEM])).toEqual([]);
  });

  it("names an issue that is not in the manifest", () => {
    expect(goldenProblems(goldenOf(VALUE), [], [])).toEqual([`${ITEM.id}: not an issue of the manifest`]);
  });

  it("names a stale hash", () => {
    expect(goldenProblems(goldenOf(VALUE, "0000"), [ITEM.id], [ITEM])).toEqual([`${ITEM.id}: inputHash is not that of its golden input`]);
  });

  it("names a value of the wrong shape", () => {
    expect(goldenProblems(goldenOf({ stories: [] }), [ITEM.id])).toEqual([`${ITEM.id}: value needs stories and excluded (lists)`]);
  });

  it("names a long label, a bad category or importance, and a url not in the text", () => {
    const bad = {
      stories: [
        { label: "one two three four five six seven eight nine ten eleven", url: "", category: "Launches", importance: 3 },
        { label: "Bad", url: "https://other.example/x", category: "Gossip", importance: 7 },
        { label: "Roundup", url: "https://acme.example/model", category: "Tools", importance: 2, roundup: true },
      ],
      excluded: [{ label: "Ad", reason: "" }],
    };
    expect(goldenProblems(goldenOf(bad), [ITEM.id], [ITEM])).toEqual([
      `${ITEM.id} story 1: label needs 1 to 10 words`,
      `${ITEM.id} story 2: category Gossip is not one of STORY_CATEGORIES`,
      `${ITEM.id} story 2: importance must be an integer 1 to 5`,
      `${ITEM.id} story 2: url is not a link in the issue text`,
      `${ITEM.id} story 3: a roundup's url is ""`,
      `${ITEM.id} excluded 1: reason is empty`,
    ]);
  });
});

describe("golden.json", () => {
  const golden = loadGolden<ExtractionGolden>(GOLDEN_PATH);

  it("is made by Claude Opus", () => {
    expect(golden.producer).toBe("claude-opus-5-5");
  });

  it("has well-formed entries for issues of the manifest", () => {
    expect(goldenProblems(golden, readManifest().map((issue) => issue.id))).toEqual([]);
  });

  // The built text is local only (evals/data is gitignored): check hashes and urls when it is there.
  it.skipIf(!existsSync(DATASET_PATH))("matches the built issue text", () => {
    expect(goldenProblems(golden, readManifest().map((issue) => issue.id), readDataset())).toEqual([]);
  });
});
