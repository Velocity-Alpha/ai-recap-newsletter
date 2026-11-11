// Builds evals/lead-pick/native-boards.json from the Neon dev branch (read-only): the boards of the native approval
// commits (newsletter.approval_outlines) after the n8n archive, in the format of the archived boards
// (src/features/newsletter/__fixtures__/archived-boards.json): the owner's committed lead, and the candidate pool as
// of the commit time (doc 80, A.5), ranked by the board's ranking. Commit the file. Then run build-summaries.ts for
// the new stories' summaries.
//
// Usage: npm run eval:build -- evals/lead-pick/build-native-boards.ts
// Needs DATABASE_URL (the Neon dev branch).

import { writeFileSync } from "node:fs";

import { archiveJson, NATIVE_BOARDS_PATH, nativeBoard, type NativeCommit, type PoolRow } from "@/evals/lead-pick/native-board";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import { storyUrlKey } from "@/src/features/newsletter/story-url";

/** The n8n archive's commits end here; later boards are native commits. */
const LAST_ARCHIVED_DATE = "2026-11-04";
const PAYWALL = new Set(["yes", "no", "unknown", "error"]);

const NOTE =
  "Approval boards of the native approval commits (newsletter.approval_outlines) after the n8n archive, rebuilt from " +
  "the Neon dev branch by evals/lead-pick/build-native-boards.ts in the format of " +
  "src/features/newsletter/__fixtures__/archived-boards.json. lead_id: the story the owner committed as the lead. " +
  "ranked_pool: the candidate pool as of the commit time (importance 2+, day D-3 to D, created by the commit, not " +
  "published before D by row or URL, not excluded, no newsletter URL, guid and URL copies merged), in the board's " +
  "ranking. removed_ids: empty, because the duplicate check's removals were not stored. sources: the row's own " +
  "source (story_sources starts later). default_selected: the stories the rebuilt board pre-selects. approved_count: " +
  "the stories the commit approved. Ids, categories, headlines and scores; no summaries or story text.";

interface CommitRow {
  date: string;
  committedAt: Date;
  payload: { leadStoryId?: number | null; sections?: NativeCommit["sections"] };
}

type StoryRow = Omit<PoolRow, "sources">;

async function poolFor(date: string, committedAt: Date): Promise<PoolRow[]> {
  const rows = await readOnlyQuery<StoryRow>(
    `SELECT id, guid, day, headline, summary, story_details, category, source, url, importance_score, paywall_detected
       FROM newsletter.stories
      WHERE importance_score >= 2
        AND day BETWEEN ($1::date - 3) AND $1::date
        AND "createdAt" <= $2
        AND (used_in_publication_date IS NULL OR used_in_publication_date >= $1::date)
        AND NOT exclude_from_candidates
        AND url IS NOT NULL AND url <> ''
        AND url NOT ILIKE '%tldr%' AND url NOT ILIKE '%rundown%' AND url NOT ILIKE '%beehiiv%'
      ORDER BY day DESC, id DESC`,
    [date, committedAt]
  );
  return (rows ?? []).map((row) => ({
    ...row,
    id: Number(row.id),
    paywall_detected: PAYWALL.has(String(row.paywall_detected)) ? (row.paywall_detected as PoolRow["paywall_detected"]) : "unknown",
  }));
}

async function publishedUrlKeys(date: string): Promise<Set<string>> {
  const rows = await readOnlyQuery<{ url: string }>(
    "SELECT url FROM newsletter.stories WHERE used_in_publication_date < $1::date AND url IS NOT NULL",
    [date]
  );
  return new Set((rows ?? []).flatMap((row) => storyUrlKey(row.url) ?? []));
}

async function main() {
  const commits = await readOnlyQuery<CommitRow>(
    `SELECT to_char(issue_date, 'YYYY-MM-DD') AS date, committed_at AS "committedAt", payload
       FROM newsletter.approval_outlines
      WHERE committed_at IS NOT NULL AND issue_date > $1::date
      ORDER BY issue_date, committed_at`,
    [LAST_ARCHIVED_DATE]
  );
  if (commits === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  // The last commit of a date is the one that made the issue.
  const latest = [...new Map(commits.map((commit) => [commit.date, commit])).values()];

  const boards = [];
  for (const commit of latest) {
    if (!commit.payload.leadStoryId || !commit.payload.sections) {
      console.info(`${commit.date}: no committed lead, skipped.`);
      continue;
    }
    const native: NativeCommit = { date: commit.date, leadStoryId: commit.payload.leadStoryId, sections: commit.payload.sections };
    const board = nativeBoard(native, await poolFor(commit.date, commit.committedAt), await publishedUrlKeys(commit.date));
    boards.push(board);
    console.info(`${board.date}: pool of ${board.ranked_pool.length}, lead ${board.lead_id}.`);
  }
  writeFileSync(NATIVE_BOARDS_PATH, archiveJson({ note: NOTE, boards }));
  console.info(`Wrote ${boards.length} boards to ${NATIVE_BOARDS_PATH}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
