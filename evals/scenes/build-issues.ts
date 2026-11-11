// Builds the scene evals' test set, evals/scenes/issues.json, from the Neon dev branch (read-only): the published
// issues of SCENE_ISSUE_DATES, each as the context the draft builds for the featured image (our own text only).
// Commit the file: the evals read it, so a reset of the dev branch does not change their test set.
//
// Usage: npm run eval:build -- evals/scenes/build-issues.ts
// Needs DATABASE_URL (the Neon dev branch).

import { writeFileSync } from "node:fs";

import { readOnlyQuery } from "@/evals/lib/dev-db";
import { sceneIssueFrom, type IssueRow } from "@/evals/scenes/issue-context";
import { SCENE_ISSUES_PATH, type SceneIssuesFile } from "@/evals/scenes/issues";

const SCENE_ISSUE_DATES = { from: "2026-10-26", to: "2026-11-06" };

async function main() {
  const rows = await readOnlyQuery<IssueRow>(
    `SELECT id, to_char(issue_date, 'YYYY-MM-DD') AS date, content_json AS content
       FROM newsletter.issues
      WHERE status = 'published' AND issue_date BETWEEN $1 AND $2
        AND jsonb_typeof(content_json->'headlines') = 'array' AND jsonb_array_length(content_json->'headlines') > 0
      ORDER BY issue_date`,
    [SCENE_ISSUE_DATES.from, SCENE_ISSUE_DATES.to]
  );
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  if (rows.length === 0) throw new Error(`No published issues from ${SCENE_ISSUE_DATES.from} to ${SCENE_ISSUE_DATES.to} on the Neon dev branch.`);
  const file: SceneIssuesFile = {
    note:
      "The published issues of the scene evals, read from the Neon dev branch by evals/scenes/build-issues.ts: " +
      "each issue's subject line and Top Stories (headline and story detail), as imageContextFor builds them. Our own text only.",
    ...SCENE_ISSUE_DATES,
    issues: rows.map(sceneIssueFrom),
  };
  writeFileSync(SCENE_ISSUES_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.info(`Wrote ${file.issues.length} issues to ${SCENE_ISSUES_PATH}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
