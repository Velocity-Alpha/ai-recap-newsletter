// Builds evals/data/extraction/dataset.json (gitignored) from manifest.json: fetches each public issue page,
// turns it into extractor text, and reads the Neon dev reference (read-only). Third-party text: never commit it.
//   with DATABASE_URL for Neon dev:  npx vite-node -c evals/vitest.eval.config.ts evals/extraction/build-dataset.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { DATA_DIR, DATASET_PATH, issueText, readManifest, type ExtractionCase, type ManifestIssue } from "@/evals/extraction/dataset";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import { readPostMeta } from "@/src/pipeline/ingest/beehiiv-site";
import { BROWSER_USER_AGENT, resolveTrackingLinks } from "@/src/pipeline/ingest/redirects";
import { STORY_SOURCES } from "@/src/pipeline/ingest/sources";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

async function fetchPage(url: string): Promise<string> {
  const response = await fetch(url, { headers: { "user-agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
  return response.text();
}

async function reference(issue: ManifestIssue): Promise<{ count: number | null; urls: string[] }> {
  if (!issue.reference) return { count: null, urls: [] };
  const rows = await readOnlyQuery<{ url: string }>(
    "SELECT url FROM newsletter.stories WHERE source = $1 AND day = ANY($2::date[])",
    [issue.reference.source, issue.reference.days]
  );
  if (rows === null) return { count: null, urls: [] };
  return { count: rows.length, urls: rows.map((row) => cleanStoryUrl(row.url)).filter(Boolean) };
}

async function main() {
  const cases: ExtractionCase[] = [];
  for (const issue of readManifest()) {
    const html = await fetchPage(issue.url);
    mkdirSync(join(DATA_DIR, "html"), { recursive: true });
    writeFileSync(join(DATA_DIR, "html", `${issue.id}.html`), html);
    // Production reads free beehiiv posts only.
    if (issue.format === "beehiiv" && !readPostMeta(html).free) throw new Error(`${issue.id} is a paid post.`);
    // As production does for the source's email: swap its click-tracking links for their targets.
    const source = STORY_SOURCES.find((candidate) => candidate.key === issue.source);
    const pattern = source?.kind === "gmail" ? source.trackingLinks : undefined;
    const raw = issueText(issue.format, html);
    const text = pattern ? await resolveTrackingLinks(raw, pattern) : raw;
    writeFileSync(join(DATA_DIR, `${issue.id}.txt`), text);
    const ref = await reference(issue);
    cases.push({ ...issue, text, referenceCount: ref.count, referenceUrls: ref.urls });
    console.info(`${issue.id}: ${text.length} chars; reference ${ref.count ?? "none"}`);
  }
  writeFileSync(DATASET_PATH, `${JSON.stringify(cases, null, 2)}\n`);
  console.info(`Wrote ${DATASET_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
