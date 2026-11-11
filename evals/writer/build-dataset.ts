// Builds the writer eval's test set (evals/writer/dataset.ts) from the Neon dev branch, read-only, the way
// drafting builds the writer's input: the issue's approved sections (approved-stories.ts toApprovedSections), the
// lead first, notes, and article text for feature stories (the saved copy in story_articles, else the repo's
// article reader, else none). Writes evals/data/writer/<date>.json, which git ignores.
//
// Usage: npm run eval:build -- evals/writer/build-dataset.ts
// Needs DATABASE_URL (the Neon dev branch). JINA_API_KEY and GITHUB_TOKEN help the article reader, if set.

import { mkdirSync, writeFileSync } from "node:fs";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { caseFile, DATA_DIR, readManifest, type ArticleSource, type ManifestEntry, type WriterCase } from "@/evals/writer/dataset";
import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import { toApprovedSections, type StoryRow } from "@/src/pipeline/draft/approved-stories";
import { parseInThisThread, readArticles, readerOptionsFromEnv } from "@/src/pipeline/draft/articles";
import { CONTENT_SECTION_KEYS, FEATURE_SECTIONS, type ApprovedStory } from "@/src/pipeline/draft/content";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import type { ArticleText } from "@/src/pipeline/draft/writer";

/** issue_stories.section (content key) -> board section key. */
const BOARD_KEY = Object.fromEntries(
  CANDIDATE_SECTION_CONFIGS.map((config) => [CONTENT_SECTION_KEYS[config.key], config.key])
) as Record<string, SectionKey>;

async function query<Row>(sql: string, params: unknown[]): Promise<Row[]> {
  const rows = await readOnlyQuery<Row>(sql, params);
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  return rows;
}

/** A published issue's outline, from what the sent email held: sections, positions, and the links sent. */
async function outlineFromIssueStories(entry: ManifestEntry): Promise<ApprovalOutline> {
  const rows = await query<{ story_id: number; section: string; position: number; url: string | null; is_lead: boolean | null }>(
    "SELECT story_id, section, position, url, is_lead FROM newsletter.issue_stories WHERE issue_id = $1 ORDER BY section, position",
    [entry.issueId]
  );
  if (rows.length === 0) throw new Error(`Issue ${entry.issueId} (${entry.date}) has no issue_stories.`);
  const sections = CANDIDATE_SECTION_CONFIGS.map((config) => ({
    key: config.key as string,
    storyIds: rows.filter((row) => BOARD_KEY[row.section] === config.key).map((row) => row.story_id),
  }));
  // The sent email opens with the lead (toApprovedSections puts it first in Top Stories), so the first Top
  // Story is the lead when is_lead is unknown (the backfill).
  const lead = rows.find((row) => row.is_lead) ?? rows.find((row) => row.section === "headlines" && row.position === 1);
  return {
    date: entry.date,
    sections,
    leadStoryId: lead?.story_id ?? null,
    // The link that was sent stands for the board's link edit. No notes are known for these issues.
    stories: rows.map((row) => ({ id: row.story_id, section: BOARD_KEY[row.section], url: row.url, note: "" })),
    excluded: [],
  };
}

async function outlineFromCommit(entry: ManifestEntry): Promise<ApprovalOutline> {
  const rows = await query<{ payload: ApprovalOutline }>(
    "SELECT payload FROM newsletter.approval_outlines WHERE issue_date = $1::date ORDER BY committed_at DESC LIMIT 1",
    [entry.date]
  );
  if (rows.length === 0) throw new Error(`No approval outline for ${entry.date}.`);
  return rows[0].payload;
}

async function storyRows(ids: number[]): Promise<StoryRow[]> {
  return query<StoryRow>(
    `SELECT id, headline, summary, story_details AS "storyDetails", url, note FROM newsletter.stories WHERE id = ANY($1::int[])`,
    [ids]
  );
}

/** The saved copy first (as drafting reuses it), then the article reader, else unread. */
async function featureArticles(stories: ApprovedStory[]): Promise<{ articles: ArticleText[]; sources: Record<string, ArticleSource> }> {
  const saved = await query<{ story_id: number; url: string; text: string }>(
    "SELECT story_id, url, text FROM newsletter.story_articles WHERE story_id = ANY($1::int[]) AND status = 'read' AND text IS NOT NULL",
    [stories.map((story) => story.id)]
  );
  const savedText = new Map(
    saved.filter((row) => stories.some((story) => story.id === row.story_id && story.url === row.url)).map((row) => [row.story_id, row.text])
  );
  const toRead = stories.filter((story) => !savedText.has(story.id));
  const fresh = toRead.length
    ? await readArticles(
        toRead.map((story) => ({ id: story.id, url: story.url })),
        { ...readerOptionsFromEnv(process.env), parse: parseInThisThread }
      )
    : { articles: [], reads: [] };
  const freshById = new Map(fresh.reads.map((read) => [read.storyId, read]));

  const articles: ArticleText[] = [];
  const sources: Record<string, ArticleSource> = {};
  for (const story of stories) {
    const text = savedText.get(story.id);
    if (text) {
      articles.push({ storyId: story.id, text });
      sources[story.id] = "saved";
      continue;
    }
    const read = freshById.get(story.id);
    if (read?.status === "read" && read.text) {
      articles.push({ storyId: story.id, text: read.text });
      sources[story.id] = `read:${read.method ?? "unknown"}`;
    } else {
      articles.push({ storyId: story.id, unread: true });
      sources[story.id] = `unread:${read?.status ?? "not tried"}`;
    }
  }
  return { articles, sources };
}

async function buildCase(entry: ManifestEntry): Promise<WriterCase> {
  const outline = entry.sections === "approval_outline" ? await outlineFromCommit(entry) : await outlineFromIssueStories(entry);
  const ids = outline.sections.flatMap((section) => section.storyIds);
  const sections = toApprovedSections(outline, await storyRows(ids));
  const features = (FEATURE_SECTIONS as readonly SectionKey[]).flatMap((key) => sections[key]);
  const { articles, sources } = await featureArticles(features);
  return {
    date: entry.date,
    issueId: entry.issueId,
    sections: entry.sections,
    input: { sections, leadStoryId: outline.leadStoryId, articles },
    articleSources: sources,
  };
}

async function main() {
  if (process.env.APP_ENV === "production") throw new Error("Refusing to run with APP_ENV=production.");
  mkdirSync(DATA_DIR, { recursive: true });
  for (const entry of readManifest()) {
    const built = await buildCase(entry);
    writeFileSync(caseFile(entry.date), `${JSON.stringify(built, null, 2)}\n`);
    const counts = Object.values(built.articleSources).join(", ");
    console.info(`${entry.date}: ${ids(built)} stories; feature articles: ${counts}`);
  }
}

function ids(built: WriterCase): number {
  return Object.values(built.input.sections).reduce((sum, list) => sum + list.length, 0);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => process.exit());
