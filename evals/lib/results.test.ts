import { describe, expect, it } from "vitest";

import { mergeRows, readRows, renderResults, type ResultRow } from "@/evals/lib/results";

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
