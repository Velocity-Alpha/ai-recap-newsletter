/**
 * Compares the content native publish would write with what is already stored (n8n's AI parse during
 * shadow mode). Quote style, spacing, and numeric-string story ids are not differences: the AI returns
 * those inconsistently and the website renders them the same.
 */

const MAX_VALUE_CHARS = 80;

function normalize(value: unknown, key?: string): unknown {
  if (key === "story_id" && typeof value === "string" && /^\d+$/.test(value.trim())) return Number(value);
  if (typeof value === "string") {
    return value
      .replace(/[‘’]/g, "'")
      .replace(/[“”]/g, '"')
      .replace(/\s+/g, " ")
      .trim();
  }
  if (Array.isArray(value)) return value.map((item) => normalize(item));
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, normalize(v, k)]));
  }
  return value;
}

function show(value: unknown): string {
  const text = JSON.stringify(value) ?? "undefined";
  return text.length > MAX_VALUE_CHARS ? `${text.slice(0, MAX_VALUE_CHARS)}…` : text;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walk(path: string, native: unknown, published: unknown, out: string[]): void {
  if (Array.isArray(native) && Array.isArray(published)) {
    if (native.length !== published.length) {
      out.push(`${path}: native has ${native.length} items, published has ${published.length}`);
    }
    for (let i = 0; i < Math.min(native.length, published.length); i += 1) {
      walk(`${path}[${i}]`, native[i], published[i], out);
    }
    return;
  }
  if (isObject(native) && isObject(published)) {
    for (const key of new Set([...Object.keys(native), ...Object.keys(published)])) {
      walk(path ? `${path}.${key}` : key, native[key], published[key], out);
    }
    return;
  }
  if (JSON.stringify(native) !== JSON.stringify(published)) {
    out.push(`${path}: native=${show(native)} published=${show(published)}`);
  }
}

export function diffIssueContent(native: unknown, published: unknown): string[] {
  const out: string[] = [];
  walk("", normalize(native), normalize(published), out);
  return out;
}
