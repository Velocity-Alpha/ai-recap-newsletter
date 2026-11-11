// Writes each writer case's golden input to evals/data/writer/golden-inputs/<date>.json (gitignored), for the
// agents that write the golden issues (evals/writer/golden-todo.md).
// --merge: gathers the entries the agents wrote to evals/data/writer/golden-entries/<date>.json into
//   evals/data/writer/golden.json (an entry there is replaced by a newer file of the same date).
// --check: checks the golden issues in golden.json: each must be current (inputHash), match the writer's schema,
//   and pass the writer's checks and the eval's code checks.
//
// Usage: npm run eval:build -- evals/writer/golden-inputs.ts [--merge | --check]
// Reads the built cases (evals/writer/build-dataset.ts); no database, no network.

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { goldenFor, hashInput, loadGolden, missingGolden, type Golden, type GoldenEntry } from "@/evals/lib/golden";
import { loadCases } from "@/evals/writer/dataset";
import { GOLDEN_ENTRIES_DIR, GOLDEN_INPUTS_DIR, GOLDEN_PATH, goldenInputFile, goldenInputOf, goldenProblems, type GoldenIssue } from "@/evals/writer/golden";
import { draftCheckFailures } from "@/evals/writer/score";

function writeInputs() {
  mkdirSync(GOLDEN_INPUTS_DIR, { recursive: true });
  const cases = loadCases();
  for (const item of cases) {
    const file = goldenInputFile(item, hashInput(goldenInputOf(item)));
    writeFileSync(join(GOLDEN_INPUTS_DIR, `${item.date}.json`), `${JSON.stringify(file, null, 2)}\n`);
  }
  console.info(`Wrote ${cases.length} golden inputs to ${GOLDEN_INPUTS_DIR}`);
}

const ABOUT =
  "Writer eval golden issues: one reference issue per case, in the writer's schema, written by Claude Opus from the writer's exact input and instructions (evals/writer/golden-todo.md).";

function merge() {
  const golden: Golden<GoldenIssue> = existsSync(GOLDEN_PATH)
    ? loadGolden<GoldenIssue>(GOLDEN_PATH)
    : { about: ABOUT, producer: "claude-opus-5-5", entries: {} };
  const files = existsSync(GOLDEN_ENTRIES_DIR) ? readdirSync(GOLDEN_ENTRIES_DIR).filter((name) => name.endsWith(".json")) : [];
  for (const name of files) {
    golden.entries[name.replace(/\.json$/, "")] = JSON.parse(readFileSync(join(GOLDEN_ENTRIES_DIR, name), "utf8")) as GoldenEntry<GoldenIssue>;
  }
  const entries = Object.fromEntries(Object.entries(golden.entries).sort(([a], [b]) => b.localeCompare(a)));
  writeFileSync(GOLDEN_PATH, `${JSON.stringify({ ...golden, entries }, null, 2)}\n`);
  console.info(`Merged ${files.length} entry files; ${GOLDEN_PATH} has ${Object.keys(entries).length} entries.`);
}

function check() {
  const cases = loadCases();
  const golden = loadGolden<GoldenIssue>(GOLDEN_PATH);
  const missing = new Set(missingGolden(golden, cases.map((item) => ({ id: item.date, input: goldenInputOf(item) }))));
  let bad = 0;
  for (const item of cases) {
    if (missing.has(item.date)) {
      console.info(`${item.date}: missing or stale`);
      bad++;
      continue;
    }
    const value = goldenFor(golden, item.date, goldenInputOf(item));
    const problems = goldenProblems(item, value);
    const failures = problems.length === 0 ? draftCheckFailures(item, value) : [];
    if (problems.length + failures.length > 0) bad++;
    console.info(`${item.date}: ${[...problems, ...failures].join(" | ") || "ok"}`);
  }
  console.info(`${cases.length - bad} of ${cases.length} golden issues usable.`);
  if (bad > 0) process.exitCode = 1;
}

try {
  if (process.argv.includes("--check")) check();
  else if (process.argv.includes("--merge")) merge();
  else writeInputs();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
