// Story extraction (src/pipeline/ingest/extract.ts) on public past issues, scored against golden values. evals/README.md.
import { expect, it } from "vitest";

import { readDataset, type ExtractionCase } from "@/evals/extraction/dataset";
import { GOLDEN_PATH, goldenInput, type ExtractionGolden } from "@/evals/extraction/golden";
import { GRADE_RUBRIC, GRADE_SCHEMA, gradeInput, type ExtractionGrade } from "@/evals/extraction/judge";
import { checkExtraction, foundGolden, linkedStoryUrls, scoreExtraction, urlsInText, type ExtractionOutput } from "@/evals/extraction/score";
import { goldenFor, loadGolden } from "@/evals/lib/golden";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { createOpenAIExtractor, EXTRACTION_EFFORT, EXTRACTION_MODEL } from "@/src/pipeline/ingest/extract";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

type ExtractionItem = ExtractionCase & { golden: ExtractionGolden };

async function extract(item: ExtractionItem, context: RunContext): Promise<ExtractionOutput> {
  const extractor = createOpenAIExtractor({ client: context.client, model: context.config.model, effort: context.config.effort });
  return { stories: await extractor(goldenInput(item)) };
}

/** A judge failure leaves the run ungraded (the Graded column), not failed: the extraction itself worked. */
function grade(item: ExtractionItem, output: ExtractionOutput, context: GradeContext): Promise<ExtractionGrade> {
  return context.judge<ExtractionGrade>({
    name: "extraction_grade",
    instructions: GRADE_RUBRIC,
    input: gradeInput({ sourceDate: item.date, text: item.text, golden: item.golden, stories: output.stories }),
    schema: GRADE_SCHEMA,
  });
}

it("extraction: stories from past issues, against golden", async () => {
  const settings = evalSettings({ model: EXTRACTION_MODEL, efforts: ["none", "low", "medium", "high"], repeats: 2, baseline: EXTRACTION_EFFORT });
  const golden = loadGolden<ExtractionGolden>(GOLDEN_PATH);
  // goldenFor throws for an issue with no golden value, or whose text changed since: make it first (golden-todo.md).
  const items: ExtractionItem[] = readDataset().map((item) => ({ ...item, golden: goldenFor(golden, item.id, goldenInput(item)) }));
  const sources = [...new Set(items.map((item) => item.source))].join(", ");
  const dates = items.map((item) => item.date).sort();

  const { rows, path } = await runSweep({
    task: "extraction",
    title: "Story extraction eval",
    notes: [
      `The extractor on ${items.length} past issues (${dates[0]} to ${dates.at(-1)}) of ${sources}: their public web ` +
        "versions (`evals/extraction/manifest.json`, chosen by `evals/extraction/find-issues.ts`), built into text by " +
        "`evals/extraction/build-dataset.ts` with the repo's own helpers (beehiiv reader, `htmlToText`, tracking-link resolver) " +
        "into `evals/data/extraction/` (gitignored). Production reads the email sources' plain-text part, so the text is close " +
        "to, not the same as, what production sees. AlphaSignal has no public issue archive and is not in the set.",
      "Golden (`evals/extraction/golden.json`, by Claude Opus from the issue text by the prompt's own rules, " +
        "`evals/extraction/golden-todo.md`): per issue, the stories a perfect extraction returns (label, url, category, " +
        "importance) and the items it must leave out.",
      "Issues: per issue run. Valid output: the call returned stories matching the schema (two tries, as in production). " +
        "All story URLs in text: every non-empty url is a link in the text (compared cleaned). No duplicates: by cleaned url or " +
        "headline. Golden URLs found: golden stories with a url that the run returned (cleaned), with no judge.",
      "The judge (the Judge column gives each row's model and effort; rubric in `evals/extraction/judge.ts`) matches each " +
        "extracted story to a golden story, or calls it a roundup item, filtered, merged, a fragment or extra. Recall = golden " +
        "stories matched (a roundup split into items counts as found). Precision = extracted stories that are one golden story, " +
        "over all but roundup items. Category, Importance within 1 and URL are compared with the matched golden story. " +
        "Faithful = no fact the text does not state, and Headline rules, are still the judge's, over every extracted story.",
      "Saved per issue: stories with a usable link, as ingestion saves them. Dev DB: the Neon dev branch `stories` rows of the " +
        "same source and day, which the production or n8n extractor made from the email (The Signal 2026-10-25 is under n8n's " +
        "`tldr_ai` label); issues with fewer than 3 such rows have none. Dev DB URLs found: those rows' links that this run also saved.",
      "p50/p95 time the extraction call alone. Rows from before the golden values (git sha 78ec0c8 and earlier) ran 12 issues " +
        "and the judge counted recall, category, importance and URL by its own reading of the rules: they are not comparable.",
    ],
    settings,
    items,
    id: (item) => item.id,
    run: extract,
    grade,
    score: scoreExtraction,
    raw: (outcome) => {
      const stories = outcome.output?.stories ?? [];
      const grade = outcome.grade;
      return {
        stories: stories.length,
        golden: outcome.item.golden.stories.length,
        saved: linkedStoryUrls(stories, outcome.item.url).length,
        referenceCount: outcome.item.referenceCount,
        checks: outcome.output ? checkExtraction(outcome.item.text, stories) : null,
        urlsNotInText: stories.map((story) => cleanStoryUrl(story.url)).filter((url) => url && !urlsInText(outcome.item.text).has(url)),
        storyList: stories.map((story) => ({ headline: story.headline, category: story.category, importance: story.importance_score })),
        grade: grade && { found: [...foundGolden(outcome.item.golden, grade.stories)], verdicts: grade.stories },
      };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
