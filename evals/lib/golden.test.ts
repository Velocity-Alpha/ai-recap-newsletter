import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { goldenFor, hashInput, loadGolden, missingGolden, type Golden } from "@/evals/lib/golden";

const INPUT = { headline: "A", stories: [1, 2] };

const golden: Golden<string[]> = {
  about: "The stories each issue should yield.",
  producer: "claude-opus-5-5",
  entries: {
    "issue-1": { inputHash: hashInput(INPUT), date: "2026-11-11", value: ["a", "b"] },
    "issue-2": { inputHash: "0000000000000000", date: "2026-11-11", value: ["c"] },
  },
};

describe("hashInput", () => {
  it("is 16 hex characters", () => {
    expect(hashInput(INPUT)).toMatch(/^[0-9a-f]{16}$/);
  });

  it("does not depend on the order of object keys", () => {
    expect(hashInput({ b: 1, a: { d: 2, c: 3 } })).toBe(hashInput({ a: { c: 3, d: 2 }, b: 1 }));
  });

  it("changes when a value changes", () => {
    expect(hashInput({ ...INPUT, headline: "B" })).not.toBe(hashInput(INPUT));
  });

  it("keeps the order of arrays", () => {
    expect(hashInput([1, 2])).not.toBe(hashInput([2, 1]));
  });
});

describe("goldenFor", () => {
  it("gives the value of a fresh entry", () => {
    expect(goldenFor(golden, "issue-1", INPUT)).toEqual(["a", "b"]);
  });

  it("names the item when it has no entry", () => {
    expect(() => goldenFor(golden, "issue-9", INPUT)).toThrow(/issue-9.*no golden value/);
  });

  it("names the item when the item changed since its entry was made", () => {
    expect(() => goldenFor(golden, "issue-2", INPUT)).toThrow(/issue-2.*changed.*regenerate/i);
  });
});

describe("missingGolden", () => {
  it("lists the items with no entry or a stale one, in order", () => {
    const items = [
      { id: "issue-1", input: INPUT },
      { id: "issue-2", input: INPUT },
      { id: "issue-3", input: INPUT },
    ];
    expect(missingGolden(golden, items)).toEqual(["issue-2", "issue-3"]);
  });
});

describe("loadGolden", () => {
  it("reads a golden file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "golden-")), "golden.json");
    writeFileSync(path, JSON.stringify(golden));
    expect(loadGolden<string[]>(path)).toEqual(golden);
  });

  it("refuses a file that is not a golden file, naming it", () => {
    const path = join(mkdtempSync(join(tmpdir(), "golden-")), "golden.json");
    writeFileSync(path, JSON.stringify({ entries: [] }));
    expect(() => loadGolden(path)).toThrow(path);
  });

  it("names the path when the file is missing", () => {
    expect(() => loadGolden("/nowhere/golden.json")).toThrow("/nowhere/golden.json");
  });
});
