// Builds the scene evals' test set, evals/scenes/issues.json, from the Neon dev branch (read-only): SCENE_ISSUE_COUNT
// published issues spread evenly over every published issue with Top Stories, each as the context the draft builds
// for the featured image (our own text only). The first test set (FIRST_SET_DATES) stays in, so its rows compare.
// Commit the file: the evals read it, so a reset of the dev branch does not change their test set.
//
// Usage: npm run eval:build -- evals/scenes/build-issues.ts
// Needs DATABASE_URL (the Neon dev branch).

import { writeFileSync } from "node:fs";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { sceneIssueFrom, type IssueRow } from "@/evals/scenes/issue-context";
import { pickSpread, SCENE_ISSUES_PATH, type SceneIssuesFile } from "@/evals/scenes/issues";

const SCENE_ISSUE_COUNT = 100;
/** The dates of the first test set (10 issues). */
const FIRST_SET_DATES = { from: "2026-10-26", to: "2026-11-06" };

async function main() {
  const rows = await readOnlyQuery<IssueRow>(
    `SELECT id, to_char(issue_date, 'YYYY-MM-DD') AS date, content_json AS content
       FROM newsletter.issues
      WHERE status = 'published'
        AND jsonb_typeof(content_json->'headlines') = 'array' AND jsonb_array_length(content_json->'headlines') > 0
        AND coalesce(content_json->>'title', '') <> ''
      ORDER BY issue_date, id`
  );
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  if (rows.length === 0) throw new Error("No published issues with Top Stories on the Neon dev branch.");
  // One issue per date: the evals and golden.json key items by date.
  const byDate = [...new Map(rows.map((row) => [row.date, row])).values()];
  const picked = pickSpread(byDate, SCENE_ISSUE_COUNT, (row) => row.date >= FIRST_SET_DATES.from && row.date <= FIRST_SET_DATES.to);
  const issues = picked.map(sceneIssueFrom);
  const file: SceneIssuesFile = {
    note:
      `${issues.length} published issues of the scene evals, read from the Neon dev branch by evals/scenes/build-issues.ts: ` +
      `spread evenly over the ${byDate.length} published issues with Top Stories, with every issue of ${FIRST_SET_DATES.from} to ` +
      `${FIRST_SET_DATES.to} (the first test set). Each issue's subject line and Top Stories (headline and story detail), ` +
      "as imageContextFor builds them. Our own text only.",
    from: issues[0].date,
    to: issues[issues.length - 1].date,
    issues,
  };
  writeFileSync(SCENE_ISSUES_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.info(`Wrote ${file.issues.length} issues to ${SCENE_ISSUES_PATH}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
