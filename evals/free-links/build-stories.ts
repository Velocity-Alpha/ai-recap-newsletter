// Builds evals/free-links/stories.json from the Neon dev branch (read-only): the paywalled stories (paywall check
// "yes") the free-links eval searches, our own headline and summary with the public link. Commit the file: a reset
// of the dev branch does not change the test set.
//
// Usage: npm run eval:build -- evals/free-links/build-stories.ts
// Needs DATABASE_URL (the Neon dev branch).

import { writeFileSync } from "node:fs";

import { pickStories, SET_SIZE, SITE_CAP, STORIES_PATH, type PaywalledStory, type StoriesFile } from "@/evals/free-links/stories";
import { readOnlyQuery } from "@/evals/lib/dev-db";
import answers from "@/src/pipeline/free-links/__fixtures__/search-answers.json";

async function main() {
  const rows = await readOnlyQuery<PaywalledStory>(
    `SELECT id, source, day::text AS day, trim(headline) AS headline, trim(summary) AS summary, url
       FROM newsletter.stories
      WHERE paywall_detected = 'yes' AND url IS NOT NULL AND trim(coalesce(headline, '')) <> '' AND trim(coalesce(summary, '')) <> ''
      ORDER BY day, id`
  );
  if (rows === null) throw new Error("Set DATABASE_URL to the Neon dev branch.");
  // Of the recorded answers' stories, also those whose paywall state changed since they were recorded.
  const recorded = await readOnlyQuery<{ id: number; source: string; day: string }>(
    "SELECT id, source, day::text AS day FROM newsletter.stories WHERE id = ANY($1::int[])",
    [answers.map(({ story }) => story.id)]
  );
  const byId = new Map((recorded ?? []).map((row) => [row.id, row]));
  // The recorded answers' stories stay, with the text and link they were searched with.
  const keep = answers.map(({ story }) => ({
    id: story.id,
    source: byId.get(story.id)?.source ?? "not on the dev branch",
    day: byId.get(story.id)?.day ?? story.published_on,
    headline: story.headline,
    summary: story.summary,
    url: story.url,
  }));
  const stories = pickStories(rows, keep);
  const sources = [...new Set(stories.map((story) => story.source))].sort();
  const file: StoriesFile = {
    note:
      `${stories.length} paywalled stories (paywall check "yes") of newsletter.stories on the Neon dev branch, read by ` +
      `evals/free-links/build-stories.ts from ${rows.length} with a headline and summary: the ${keep.length} stories of ` +
      "src/pipeline/free-links/__fixtures__/search-answers.json, then the sources in turn, spread over their days, one " +
      `story per link and at most ${SITE_CAP} of one site. Days ${stories[0].day} to ${stories.at(-1)!.day}; sources ` +
      `${sources.join(", ")}. Our own headlines and summaries; public links.`,
    stories,
  };
  if (stories.length < SET_SIZE) console.warn(`Only ${stories.length} of ${SET_SIZE} stories.`);
  writeFileSync(STORIES_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.info(`Wrote ${stories.length} stories to ${STORIES_PATH}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
