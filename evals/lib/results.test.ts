import { describe, expect, it } from "vitest";

import { mergeRows, readRows, readStored, renderResults, roundValue, type ResultRow } from "@/evals/lib/results";

const row = (effort: string | null, hits: number, extra: Partial<ResultRow> = {}): ResultRow => ({
  model: "gpt-6-luna",
  effort,
  n: 30,
  errors: 0,
  metrics: [
    { name: "AI pick = owner lead", hits, n: 30 },
    { name: "Mean shortlist size", value: 8 },
  ],
  latencyMs: { p50: 1234, p95: 5678 },
  costPerCallUsd: 0.000123,
  judgeCostPerCallUsd: null,
  date: "2026-11-10",
  gitSha: "abc1234",
  ...extra,
});

describe("renderResults", () => {
  it("writes one table row per model and effort, with each metric, latency, cost, n, date and sha", () => {
    const markdown = renderResults({
      task: "lead-pick",
      title: "Lead pick",
      notes: ["Ground truth: the owner's lead."],
      rows: [row("low", 21), row(null, 24)],
    });
    expect(markdown).toContain("# Lead pick");
    expect(markdown).toContain("Ground truth: the owner's lead.");
    expect(markdown).toContain(
      "| Model | Effort | AI pick = owner lead | Mean shortlist size | Errors | p50 | p95 | Cost per call | n | Date | Git sha |"
    );
    expect(markdown).toContain("| gpt-6-luna | low | 21/30 (70%) | 8 | 0 | 1.2 s | 5.7 s | $0.000123 | 30 | 2026-11-10 | abc1234 |");
    expect(markdown).toContain("| gpt-6-luna | api default | 24/30 (80%) |");
    expect(readRows(markdown)).toEqual([row("low", 21), row(null, 24)]);
  });

  it("stores the title, notes, columns and rows, and reads them back", () => {
    const file = { title: "T", notes: ["One.", "Two."], columns: ["Mean shortlist size"], rows: [row("low", 1)] };
    expect(readStored(renderResults({ task: "t", ...file }))).toEqual(file);
  });

  it("shows only the chosen metric columns, and leaves out a column with no value in any row", () => {
    const markdown = renderResults({ task: "t", title: "T", notes: [], columns: ["Mean shortlist size", "Gone"], rows: [row("low", 1)] });
    expect(markdown).toContain("| Model | Effort | Mean shortlist size | Errors | p50 | p95 | Cost per call | n | Date | Git sha |");
  });

  it("shows the spread across repeats, rounds values, and adds graded runs, searches and the shared cost", () => {
    const markdown = renderResults({
      task: "t",
      title: "T",
      notes: [],
      rows: [
        row("low", 21, {
          metrics: [
            { name: "Hit", hits: 21, n: 30, spread: { min: 0.6, max: 0.8 } },
            { name: "Words", value: 123.456, spread: { min: 101.2, max: 140.9 } },
            { name: "Same", hits: 3, n: 3, spread: { min: 1, max: 1 } },
          ],
          graded: { hits: 9, n: 10 },
          webSearchesPerCall: 7.4,
          sharedCostUsd: 0.25,
        }),
      ],
    });
    expect(markdown).toContain("| Hit | Words | Same | Errors | Graded | p50 | p95 | Searches per call | Cost per call |");
    expect(markdown).toContain("| 21/30 (70%; 60–80%) | 123 (101–141) | 3/3 (100%) | 0 | 9/10 | 1.2 s | 5.7 s | 7.4 | $0.000123 |");
    expect(markdown).toContain("Shared work of the run of 2026-11-10 (abc1234), done once for all its configs: $0.2500.");
  });

  it("reads the rows, title and notes of a file in the old layout", () => {
    const old = [
      "# Old eval",
      "",
      "Written by `npm run eval -- evals/old`. Do not edit by hand. A run replaces the rows of the model and",
      "effort it ran; other rows stay. Latency and cost are for one item run. See evals/README.md.",
      "",
      "First note.",
      "",
      "Second note.",
      "",
      "| Model |",
      "| --- |",
      "",
      "<!-- eval-rows",
      JSON.stringify([row("low", 1)]),
      "-->",
    ].join("\n");
    expect(readStored(old)).toEqual({ title: "Old eval", notes: ["First note.", "Second note."], rows: [row("low", 1)] });
  });

  it("adds a judge cost column only when a judge was used, and shows an unknown cost", () => {
    const markdown = renderResults({
      task: "t",
      title: "T",
      notes: [],
      rows: [row("low", 1, { judgeCostPerCallUsd: 0.01, costPerCallUsd: null })],
    });
    expect(markdown).toContain("| Cost per call | Judge cost per call |");
    expect(markdown).toContain("| unknown | $0.0100 |");
  });
});

describe("roundValue", () => {
  it("keeps 2 decimals under 10, 1 under 100, none from 100, without trailing zeros", () => {
    expect([roundValue(7.916), roundValue(23.27), roundValue(131.5), roundValue(3), roundValue(2.5)]).toEqual(["7.92", "23.3", "132", "3", "2.5"]);
  });
});

describe("mergeRows", () => {
  it("replaces the rows of the configs that ran, keeps the others, and orders by model then effort", () => {
    const old = [row("high", 1), row("low", 2), row("low", 3, { model: "gpt-6-sol" })];
    const merged = mergeRows(old, [row("low", 9), row("none", 8)]);
    expect(merged.map((r) => [r.model, r.effort, r.metrics[0]])).toEqual([
      ["gpt-6-luna", "none", { name: "AI pick = owner lead", hits: 8, n: 30 }],
      ["gpt-6-luna", "low", { name: "AI pick = owner lead", hits: 9, n: 30 }],
      ["gpt-6-luna", "high", { name: "AI pick = owner lead", hits: 1, n: 30 }],
      ["gpt-6-sol", "low", { name: "AI pick = owner lead", hits: 3, n: 30 }],
    ]);
  });
});
