// Replays past board commits through native drafting (#76) and writes each email next to n8n's, for the owner
// to review side by side. It reads the files named on the command line, so no story text lives in the repo.
//
// Usage:
//   npx vite-node --config vitest.config.ts scripts/replay-drafts.mts -- \
//     --out tmp/replay [--no-read] \
//     --commit <date>.commit.json --reuse-image-from <date>.issue.json \
//     [--commit ... --reuse-image-from ... for each date]
//
//   <date>.commit.json  the board's commit body (what the board POSTs to /api/newsletters/commit)
//   <date>.issue.json   n8n's newsletter.issues row for that date (html, title, feature_image_url,
//                       prompt_featured_image, issue_date, id), as JSON
//   --no-read           skip reading the feature stories' articles: the writer gets the summaries only
//
// Needs: DATABASE_URL (the Neon dev branch; stories are only read) and OPENAI_API_KEY. Refuses APP_ENV=production.
// Optional: JINA_API_KEY and GITHUB_TOKEN, for the article reader (#120).
// Effect: no issue, draft, or saved-article row is written, articles are read from the web each time, the image
// step reuses n8n's image and scene prompt, and GHL is a dry run. Writes <out>/<date>.native.html,
// <out>/<date>.n8n.html, <out>/<date>.json (with each article's read outcome, not its text), and <out>/index.html.

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadApprovedSections } from "@/src/pipeline/draft/approved-stories";
import {
  commitOutline,
  parseReplayArgs,
  readN8nIssue,
  renderReplayIndex,
  replayArticleReader,
  replayDraft,
  type ReplayReport,
} from "@/src/pipeline/draft/replay";
import { prisma } from "@/src/server/prisma";

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function main(): Promise<void> {
  const args = parseReplayArgs(process.argv.slice(2));
  if (process.env.APP_ENV === "production") throw new Error("Refusing to replay with APP_ENV=production.");
  if (!process.env.DATABASE_URL?.trim()) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  const openAIKey = process.env.OPENAI_API_KEY?.trim();
  if (!openAIKey) throw new Error("Set OPENAI_API_KEY.");

  await mkdir(args.out, { recursive: true });
  const reports: ReplayReport[] = [];
  for (const pair of args.pairs) {
    const n8nIssue = readN8nIssue(await readJson(pair.issue));
    const outline = commitOutline(await readJson(pair.commit), n8nIssue.date);
    const stories = await loadApprovedSections(outline);
    console.log(`${outline.date}: drafting from ${pair.commit}...`);

    const reader = replayArticleReader({ read: args.read, env: process.env });
    const replayed = await replayDraft({ outline, stories, n8nIssue }, { openAIKey, readArticles: reader.readArticles });
    const { nativeHtml, n8nHtml } = replayed;
    const report: ReplayReport = { ...replayed.report, articles: reader.reads() };
    await writeFile(path.join(args.out, `${report.date}.native.html`), nativeHtml);
    await writeFile(path.join(args.out, `${report.date}.n8n.html`), n8nHtml);
    await writeFile(path.join(args.out, `${report.date}.json`), `${JSON.stringify(report, null, 2)}\n`);
    reports.push(report);

    const outcome = report.status === "ready" ? "ready" : `failed at ${report.failedStep}: ${report.error}`;
    console.log(`${report.date}: ${outcome}; ${report.problems.length} problem(s); ${report.unreadStoryIds.length} article(s) not read; ${report.totalMs} ms.`);
  }

  await writeFile(path.join(args.out, "index.html"), renderReplayIndex(reports));
  console.log(`Open ${path.join(args.out, "index.html")}`);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(async () => {
    if (process.env.DATABASE_URL?.trim()) await prisma.$disconnect();
    // The pg pool's idle connections would otherwise keep the process open.
    process.exit();
  });
