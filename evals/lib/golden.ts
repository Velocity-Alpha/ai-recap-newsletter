import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";

/**
 * Golden values: the answer a stronger model than the one under test (here Claude Opus, run from Claude Code)
 * gave for each item, for the judge to compare outputs to. Each entry keeps a hash of the item's input, so an
 * entry made for an older version of the item is refused. evals/README.md, "Golden values".
 *
 * Committed golden files live at evals/<task>/golden.json; golden values derived from third-party text live at
 * evals/data/<task>/golden.json (gitignored).
 */
export interface GoldenEntry<T> {
  /** hashInput of the item's input when the value was made. */
  inputHash: string;
  /** YYYY-MM-DD. */
  date: string;
  value: T;
}

export interface Golden<T> {
  /** What the values are. */
  about: string;
  /** The model that made them, for example "claude-opus-5-5". */
  producer: string;
  entries: Record<string, GoldenEntry<T>>;
}

/** JSON with the keys of every object sorted, so the same input always gives the same text. */
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map((entry) => stableJson(entry ?? null)).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const fields = Object.entries(value as Record<string, unknown>)
      .filter(([, entry]) => entry !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableJson(entry)}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

/** The first 16 hex characters of the sha256 of the input's stable JSON. */
export function hashInput(input: unknown): string {
  return createHash("sha256").update(stableJson(input)).digest("hex").slice(0, 16);
}

export function loadGolden<T>(path: string): Golden<T> {
  if (!existsSync(path)) throw new Error(`No golden file at ${path}. See evals/README.md, "Golden values".`);
  const golden = JSON.parse(readFileSync(path, "utf8")) as Golden<T>;
  const valid =
    typeof golden?.about === "string" &&
    typeof golden.producer === "string" &&
    golden.entries !== null &&
    typeof golden.entries === "object" &&
    !Array.isArray(golden.entries);
  if (!valid) throw new Error(`${path} is not a golden file: it needs "about", "producer" and "entries" (evals/lib/golden.ts).`);
  return golden;
}

/** The golden value of an item. Throws, naming the item, when it has no entry or its input changed since. */
export function goldenFor<T>(golden: Golden<T>, itemId: string, input: unknown): T {
  const entry = golden.entries[itemId];
  if (!entry) throw new Error(`Item "${itemId}" has no golden value (${golden.about}). Add it.`);
  if (entry.inputHash !== hashInput(input)) {
    throw new Error(`Item "${itemId}" changed since its golden value of ${entry.date} was made (${golden.about}). Regenerate it.`);
  }
  return entry.value;
}

/** The ids of the items with no golden value, or a stale one, in the items' order. */
export function missingGolden<T>(golden: Golden<T>, items: Array<{ id: string; input: unknown }>): string[] {
  return items.filter(({ id, input }) => golden.entries[id]?.inputHash !== hashInput(input)).map(({ id }) => id);
}
