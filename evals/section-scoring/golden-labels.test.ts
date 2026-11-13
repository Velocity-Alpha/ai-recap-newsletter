import { describe, expect, it } from "vitest";

import { addLabels, emptyGolden, type Sets } from "@/evals/section-scoring/golden-labels";
import type { LabelExport } from "@/evals/section-scoring/labels";

const sets: Sets = {
  about: "test",
  seed: 1,
  window: { from: "2026-09-01", to: "2026-10-26" },
  check: { ids: [7, 8], hidden: [8] },
  batches: [{ batch: "tuning-1", scoringVersion: "abc", picked: "2026-11-13", ids: [1, 2] }],
};

const label = (over = {}) => ({
  kind: "general" as const,
  also: null,
  importance: 3,
  state: "confirmed" as const,
  reason: "",
  labeledAt: "2026-11-13T10:00:00.000Z",
  ...over,
});

const exported: LabelExport = {
  about: "test",
  batch: "tuning-1",
  scoringVersion: "abc",
  exportedAt: "2026-11-13T11:00:00.000Z",
  labels: [
    { storyId: 1, inputHash: "h1", recommendation: { kind: "general", importance: 3 }, label: label() },
    {
      storyId: 2,
      inputHash: "h2",
      recommendation: { kind: "tools", importance: 2 },
      label: label({ kind: "research", state: "overridden", reason: "a paper" }),
    },
  ],
};

describe("addLabels", () => {
  it("adds one entry per story, keyed by story id, with the set, the batch and the date", () => {
    const golden = addLabels(emptyGolden(), exported, sets);
    expect(Object.keys(golden.entries)).toEqual(["1", "2"]);
    expect(golden.entries["2"]).toEqual({
      inputHash: "h2",
      date: "2026-11-13",
      value: {
        set: "tuning",
        batch: "tuning-1",
        scoringVersion: "abc",
        recommendation: { kind: "tools", importance: 2 },
        kind: "research",
        also: null,
        importance: 3,
        state: "overridden",
        reason: "a paper",
      },
    });
  });

  it("marks check-set stories as check, and says when no recommendation was shown", () => {
    const check: LabelExport = {
      ...exported,
      batch: "check",
      labels: [{ storyId: 8, inputHash: "h8", recommendation: null, label: label({ state: "unprompted" }) }],
    };
    const golden = addLabels(emptyGolden(), check, sets);
    expect(golden.entries["8"].value).toMatchObject({ set: "check", batch: "check", recommendation: null });
  });

  it("replaces an older label of the same story", () => {
    const first = addLabels(emptyGolden(), exported, sets);
    const again = addLabels(first, { ...exported, labels: [{ ...exported.labels[0], label: label({ state: "either" }) }] }, sets);
    expect(again.entries["1"].value.state).toBe("either");
    expect(Object.keys(again.entries)).toHaveLength(2);
  });

  it("refuses a story that is not in the batch it was exported for", () => {
    const wrong = { ...exported, labels: [{ ...exported.labels[0], storyId: 7 }] };
    expect(() => addLabels(emptyGolden(), wrong, sets)).toThrow(/7/);
  });

  it("refuses an unknown batch", () => {
    expect(() => addLabels(emptyGolden(), { ...exported, batch: "tuning-9" }, sets)).toThrow(/tuning-9/);
  });
});
