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

const render = (rows: ResultRow[], extra: { notes?: string[]; columns?: string[] } = {}) =>
  renderResults({ task: "t", title: "T", notes: [], ...extra, rows });

describe("renderResults", () => {
  it("writes the title and notes", () => {
    const markdown = renderResults({ task: "lead-pick", title: "Lead pick", notes: ["Ground truth: the owner's lead."], rows: [row("low", 21)] });
    expect(markdown).toContain("# Lead pick");
    expect(markdown).toContain("Ground truth: the owner's lead.");
  });

  it("writes a header of each metric, then errors, latency, cost, n, date and sha", () => {
    expect(render([row("low", 21)])).toContain(
      "| Model | Effort | AI pick = owner lead | Mean shortlist size | Errors | p50 | p95 | Cost per call | n | Date | Git sha |"
    );
  });

  it("writes one table row per model and effort", () => {
    expect(render([row("low", 21)])).toContain("| gpt-6-luna | low | 21/30 (70%) | 8 | 0 | 1.2 s | 5.7 s | $0.000123 | 30 | 2026-11-10 | abc1234 |");
  });

  it("names the API default plainly", () => {
    expect(render([row(null, 24)])).toContain("| gpt-6-luna | api default | 24/30 (80%) |");
  });

  it("stores the rows, and reads them back", () => {
    expect(readRows(render([row("low", 21), row(null, 24)]))).toEqual([row("low", 21), row(null, 24)]);
  });

  it("stores the title, notes and columns, and reads them back", () => {
    const file = { title: "T", notes: ["One.", "Two."], columns: ["Mean shortlist size"], rows: [row("low", 1)] };
    expect(readStored(renderResults({ task: "t", ...file }))).toEqual(file);
  });

  it("shows only the chosen metric columns", () => {
    expect(render([row("low", 1)], { columns: ["Mean shortlist size"] })).toContain("| Model | Effort | Mean shortlist size | Errors |");
  });

  it("leaves out a column with no value in any row", () => {
    expect(render([row("low", 1)], { columns: ["Mean shortlist size", "Gone"] })).not.toContain("| Gone |");
  });

  it("shows the lowest and highest repeat of a count as shares", () => {
    const markdown = render([row("low", 21, { metrics: [{ name: "Hit", hits: 21, n: 30, spread: { min: 0.6, max: 0.8 } }] })]);
    expect(markdown).toContain("| 21/30 (70%; 60–80%) |");
  });

  it("shows the lowest and highest repeat of a number, rounded", () => {
    const markdown = render([row("low", 21, { metrics: [{ name: "Words", value: 123.456, spread: { min: 101.2, max: 140.9 } }] })]);
    expect(markdown).toContain("| 123 (101–141) |");
  });

  it("shows a count's difference against the baseline, with its interval, in points", () => {
    const vsBaseline = { diff: 0.0612, low: -0.021, high: 0.139 };
    const markdown = render([row("low", 21, { metrics: [{ name: "Hit", hits: 21, n: 30, vsBaseline }] })]);
    expect(markdown).toContain("| 21/30 (70%), +6 pts (−2 to +14) |");
  });

  it("shows a difference of zero without a sign", () => {
    const vsBaseline = { diff: 0, low: -0.1, high: 0.1 };
    expect(render([row("low", 21, { metrics: [{ name: "Hit", hits: 21, n: 30, vsBaseline }] })])).toContain("0 pts (−10 to +10)");
  });

  it("marks the baseline row", () => {
    expect(render([row("medium", 21, { baseline: true })])).toContain("| gpt-6-luna | medium (baseline) |");
  });

  it("shows no spread when every repeat is the same", () => {
    expect(render([row("low", 3, { metrics: [{ name: "Same", hits: 3, n: 3, spread: { min: 1, max: 1 } }] })])).toContain("| 3/3 (100%) |");
  });

  it("adds the graded runs after the errors", () => {
    const markdown = render([row("low", 21, { graded: { hits: 9, n: 10 } })]);
    expect(markdown).toContain("| Errors | Graded | p50 |");
    expect(markdown).toContain("| 0 | 9/10 | 1.2 s |");
  });

  it("adds the web searches per call before the cost", () => {
    const markdown = render([row("low", 21, { webSearchesPerCall: 7.4 })]);
    expect(markdown).toContain("| p95 | Searches per call | Cost per call |");
    expect(markdown).toContain("| 5.7 s | 7.4 | $0.000123 |");
  });

  it("gives the cost of shared work in a line under the table", () => {
    expect(render([row("low", 21, { sharedCostUsd: 0.25 })])).toContain(
      "Shared work of the run of 2026-11-10 (abc1234), done once for all its configs: $0.2500."
    );
  });

  it("adds a judge cost column when a judge was used", () => {
    expect(render([row("low", 1, { judgeCostPerCallUsd: 0.01 })])).toContain("| Cost per call | Judge cost per call |");
  });

  it("leaves out the judge cost column when no judge was used", () => {
    expect(render([row("low", 1)])).not.toContain("Judge cost per call");
  });

  it("shows the judge's model and effort of each row that used one", () => {
    const markdown = render([row("low", 1, { judge: "gpt-6-sol / high" }), row("high", 1, { judge: "gpt-6-sol / medium" })]);
    expect(markdown).toContain("| Judge |");
    expect(markdown).toContain("| gpt-6-sol / high |");
    expect(markdown).toContain("| gpt-6-sol / medium |");
  });

  it("leaves out the judge column when no row used a judge", () => {
    expect(render([row("low", 1)])).not.toContain("| Judge |");
  });

  it("shows an unknown cost", () => {
    expect(render([row("low", 1, { judgeCostPerCallUsd: 0.01, costPerCallUsd: null })])).toContain("| unknown | $0.0100 |");
  });
});

describe("readStored", () => {
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
});

describe("roundValue", () => {
  it("keeps 2 decimals under 10", () => {
    expect(roundValue(7.916)).toBe("7.92");
  });

  it("keeps 1 decimal from 10 to under 100", () => {
    expect(roundValue(23.27)).toBe("23.3");
  });

  it("keeps no decimals from 100", () => {
    expect(roundValue(131.5)).toBe("132");
  });

  it("drops trailing zeros", () => {
    expect([roundValue(3), roundValue(2.5)]).toEqual(["3", "2.5"]);
  });
});

describe("mergeRows", () => {
  const old = [row("high", 1), row("low", 2), row("low", 3, { model: "gpt-6-sol" })];
  const merged = () => mergeRows(old, [row("low", 9), row("none", 8)]).map((r) => [r.model, r.effort, "hits" in r.metrics[0] ? r.metrics[0].hits : null]);

  it("replaces the rows of the configs that ran", () => {
    expect(merged()).toContainEqual(["gpt-6-luna", "low", 9]);
    expect(merged()).not.toContainEqual(["gpt-6-luna", "low", 2]);
  });

  it("keeps the rows of the configs that did not run", () => {
    expect(merged()).toEqual(expect.arrayContaining([["gpt-6-luna", "high", 1], ["gpt-6-sol", "low", 3]]));
  });

  it("orders the rows by model, then effort from lowest", () => {
    expect(merged().map(([model, effort]) => `${model}/${effort}`)).toEqual(["gpt-6-luna/none", "gpt-6-luna/low", "gpt-6-luna/high", "gpt-6-sol/low"]);
  });
});
