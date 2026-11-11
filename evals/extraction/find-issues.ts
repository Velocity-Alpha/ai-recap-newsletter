// Grows evals/extraction/manifest.json: finds each source's public issues in a date window, keeps the issues
// already listed, and adds issues spread evenly over the window up to PER_SOURCE each. Writes only ids, dates
// and public urls. The reference is the Neon dev branch's stories rows of the source and day (read-only),
// kept only when there are at least MIN_REFERENCE_ROWS of them (fewer is a split or partial day).
//   with DATABASE_URL for Neon dev:  npm run eval:build -- evals/extraction/find-issues.ts
// Then rebuild the text: npm run eval:build -- evals/extraction/build-dataset.ts
import { readFileSync, writeFileSync } from "node:fs";

import { MANIFEST_PATH, readManifest, spreadPick, type IssueFormat, type ManifestIssue } from "@/evals/extraction/dataset";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import { listSitemapPosts, readPostMeta } from "@/src/pipeline/ingest/beehiiv-site";
import { BROWSER_USER_AGENT } from "@/src/pipeline/ingest/redirects";

const FROM = "2026-09-14";
const TO = "2026-11-10";
const PER_SOURCE = 12;
const MIN_REFERENCE_ROWS = 3;

const NEW_YORK_DATE = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" });
const newYorkDate = (date: Date) => NEW_YORK_DATE.format(date);
const inWindow = (date: string) => date >= FROM && date <= TO;
const weekday = (date: string) => ![0, 6].includes(new Date(`${date}T12:00:00Z`).getUTCDay());

interface Candidate {
  source: string;
  prefix: string;
  format: IssueFormat;
  date: string;
  url: string;
}

async function fetchText(url: string): Promise<string | null> {
  const response = await fetch(url, { headers: { "user-agent": BROWSER_USER_AGENT }, signal: AbortSignal.timeout(30_000) });
  return response.ok ? response.text() : null;
}

function* days(): Generator<string> {
  for (let day = new Date(`${FROM}T12:00:00Z`); day.toISOString().slice(0, 10) <= TO; day.setUTCDate(day.getUTCDate() + 1)) {
    yield day.toISOString().slice(0, 10);
  }
}

/** TLDR AI: one page per weekday at tldr.tech/ai/<date>. */
async function tldr(): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const date of days()) {
    if (!weekday(date)) continue;
    const url = `https://tldr.tech/ai/${date}`;
    const html = await fetchText(url);
    if (html?.includes("content-center")) found.push({ source: "tldr", prefix: "tldr", format: "tldr_web", date, url });
  }
  return found;
}

/** The Rundown AI: the weekday morning posts of therundown.ai (the afternoon posts are its tech and robotics letters). */
async function rundown(): Promise<Candidate[]> {
  const xml = (await fetchText("https://www.therundown.ai/sitemap.xml")) ?? "";
  const found: Candidate[] = [];
  for (const [, url, lastmod] of xml.matchAll(/<loc>(https:\/\/www\.therundown\.ai\/articles\/[^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g)) {
    if (lastmod.slice(0, 10) < FROM) continue;
    const html = await fetchText(url);
    const published = html?.match(/"datePublished":"([^"]+)"/)?.[1];
    if (!published) continue;
    const at = new Date(published);
    const date = newYorkDate(at);
    if (inWindow(date) && weekday(date) && at.getUTCHours() < 13) found.push({ source: "rundown_ai", prefix: "rundown", format: "rundown_web", date, url });
  }
  return found;
}

/** A beehiiv site: free posts from its sitemap, dated by their Article data. */
async function beehiiv(site: string, source: string, prefix: string): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (const post of listSitemapPosts((await fetchText(`${site}/sitemap.xml`)) ?? "")) {
    if (!post.lastmod || post.lastmod < FROM) continue;
    const html = await fetchText(post.url);
    if (!html) continue;
    let meta;
    try {
      meta = readPostMeta(html);
    } catch {
      continue;
    }
    const date = newYorkDate(meta.publishedAt);
    if (meta.free && inWindow(date)) found.push({ source, prefix, format: "beehiiv", date, url: post.url });
  }
  return found;
}

/** The Signal: the free posts of its Substack archive. */
async function signal(): Promise<Candidate[]> {
  const found: Candidate[] = [];
  for (let offset = 0; offset < 100; offset += 25) {
    const page = JSON.parse((await fetchText(`https://thesignal.substack.com/api/v1/archive?sort=new&limit=25${offset ? `&offset=${offset}` : ""}`)) ?? "[]");
    const posts = (page.posts ?? page) as { post_date: string; audience: string; type: string; canonical_url: string }[];
    for (const post of posts) {
      const date = newYorkDate(new Date(post.post_date));
      if (post.audience === "everyone" && post.type === "newsletter" && inWindow(date)) {
        found.push({ source: "the_signal", prefix: "the-signal", format: "substack", date, url: post.canonical_url });
      }
    }
    if (posts.length < 25 || posts.some((post) => post.post_date.slice(0, 10) < FROM)) break;
  }
  return found;
}

/** One issue per source and day: the first found. */
function onePerDay(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  return candidates.filter((candidate) => !seen.has(candidate.date) && seen.add(candidate.date));
}

async function reference(source: string, date: string): Promise<ManifestIssue["reference"]> {
  const rows = await readOnlyQuery<{ n: number }>("SELECT count(*)::int AS n FROM newsletter.stories WHERE source = $1 AND day = $2::date", [source, date]);
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch: the manifest's references come from it.");
  return (rows[0]?.n ?? 0) >= MIN_REFERENCE_ROWS ? { source, days: [date] } : null;
}

async function main() {
  const existing = readManifest();
  const bySource: Candidate[][] = [
    await tldr(),
    await rundown(),
    await beehiiv("https://aibreakfast.beehiiv.com", "ai_breakfast", "ai-breakfast"),
    await beehiiv("https://intheworldofai.com", "world_of_ai", "world-of-ai"),
    await signal(),
  ];
  const issues: ManifestIssue[] = [];
  for (const candidates of bySource.map(onePerDay)) {
    const source = candidates[0]?.source;
    if (!source) throw new Error("A source has no public issues in the window: check its archive.");
    const kept = existing.filter((issue) => issue.source === source);
    const asCandidate = (issue: ManifestIssue): Candidate => ({ ...issue, prefix: issue.id.replace(/-\d{4}-\d{2}-\d{2}$/, "") });
    const picked = spreadPick(candidates, kept.map(asCandidate), PER_SOURCE, (item) => item.date);
    for (const pick of picked) {
      const old = kept.find((issue) => issue.date === pick.date);
      issues.push(old ?? { id: `${pick.prefix}-${pick.date}`, source: pick.source, date: pick.date, format: pick.format, url: pick.url, reference: await reference(pick.source, pick.date) });
    }
    console.info(`${source}: ${candidates.length} found, ${picked.length} in the manifest`);
  }
  const manifest = JSON.parse(readFileSync(MANIFEST_PATH, "utf8")) as { about: string };
  const lines = issues.map((issue) => `    ${JSON.stringify(issue)}`).join(",\n");
  writeFileSync(MANIFEST_PATH, `{\n  "about": ${JSON.stringify(manifest.about)},\n  "issues": [\n${lines}\n  ]\n}\n`);
  console.info(`Wrote ${issues.length} issues to ${MANIFEST_PATH}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
