// Story extraction (src/pipeline/ingest/extract.ts) on 12 public past issues. evals/README.md.
import { expect, it } from "vitest";

import { readDataset, type ExtractionCase } from "@/evals/extraction/dataset";
import { GRADE_RUBRIC, GRADE_SCHEMA, gradeInput, type ExtractionGrade } from "@/evals/extraction/judge";
import { checkExtraction, linkedStoryUrls, scoreExtraction, urlsInText, type ExtractionOutput } from "@/evals/extraction/score";
import { evalSettings } from "@/evals/lib/settings";
import { runSweep, type GradeContext, type RunContext } from "@/evals/lib/sweep";
import { createOpenAIExtractor, EXTRACTION_MODEL } from "@/src/pipeline/ingest/extract";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

async function extract(item: ExtractionCase, context: RunContext): Promise<ExtractionOutput> {
  const extractor = createOpenAIExtractor({ client: context.client, model: context.config.model, effort: context.config.effort });
  return { stories: await extractor({ sourceDate: item.date, text: item.text }) };
}

/** A judge failure leaves the run ungraded (the Graded column), not failed: the extraction itself worked. */
function grade(item: ExtractionCase, output: ExtractionOutput, context: GradeContext): Promise<ExtractionGrade> {
  return context.judge<ExtractionGrade>({
    name: "extraction_grade",
    instructions: GRADE_RUBRIC,
    input: gradeInput({ sourceDate: item.date, text: item.text, stories: output.stories }),
    schema: GRADE_SCHEMA,
  });
}

it("extraction: stories from past issues, checked and judged", async () => {
  const settings = evalSettings({ model: EXTRACTION_MODEL, efforts: ["none", "low", "medium", "high"], repeats: 2 });
  const items = readDataset();
  const sources = [...new Set(items.map((item) => item.source))].join(", ");

  const { rows, path } = await runSweep({
    task: "extraction",
    title: "Story extraction eval",
    notes: [
      `The extractor on ${items.length} past issues (${items[0]?.date} to ${items.at(-1)?.date}) of ${sources}: their public web ` +
        "versions (`evals/extraction/manifest.json`), built into text by `evals/extraction/build-dataset.ts` with the repo's own " +
        "helpers (beehiiv reader, `htmlToText`, tracking-link resolver) into `evals/data/extraction/` (gitignored). " +
        "Production reads the email sources' plain-text part, so the text is close to, not the same as, what production sees. " +
        "AlphaSignal has no public issue archive and is not in the set.",
      "Issues: per issue run. Valid output: the call returned stories matching the schema (two tries, as in production). " +
        "All story URLs in text: every non-empty url is a link in the text (compared cleaned). No duplicates: by cleaned url or headline.",
      "Judge (the Judge column gives each row's model and effort; rubric in `evals/extraction/judge.ts`) counts per run: " +
        "Recall = qualifying stories in the text the " +
        "extraction covers. Precision = extracted stories that are one real story (not sponsored, filtered, merged or a fragment). " +
        "Faithful = no fact the text does not state. Headline rules and URL right follow the prompt. Category right and " +
        "Importance within 1 are over the judge's real stories. Missed per issue is the judge's count.",
      "Saved per issue: stories with a usable link, as ingestion saves them. Dev DB: the Neon dev branch `stories` rows of the " +
        "same source and day, which the production or n8n extractor made from the email (The Signal 2026-10-25 is under n8n's " +
        "`tldr_ai` label; In the World of AI 2026-10-22 has none). Dev DB URLs found: those rows' links that this run also saved.",
      "p50/p95 time the extraction call alone. Rows with git sha 035179c+changes (before d1da5b8) timed the judge in " +
        "p50/p95 too, give the graded count as 'Graded runs', and have no 'Issues: all story pages in text'.",
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
        saved: linkedStoryUrls(stories, outcome.item.url).length,
        referenceCount: outcome.item.referenceCount,
        checks: outcome.output ? checkExtraction(outcome.item.text, stories) : null,
        urlsNotInText: stories.map((story) => cleanStoryUrl(story.url)).filter((url) => url && !urlsInText(outcome.item.text).has(url)),
        // Our own headlines and labels only; the judge's missed labels can quote the newsletter, so they are not kept.
        storyList: stories.map((story) => ({ headline: story.headline, category: story.category, importance: story.importance_score })),
        grade: grade && { qualifying: grade.qualifying_in_text, missed: grade.missed, verdicts: grade.stories },
      };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows.length).toBe(settings.efforts.length);
});
