import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countGraded, countHits, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { countSentences, countWords } from "@/evals/lib/text";
import type { WriterCase } from "@/evals/writer/dataset";
import { withEvalNotes } from "@/evals/writer/notes";
import type { IssueGrade } from "@/evals/writer/rubric";
import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";
import { CONTENT_SECTION_KEYS, FEATURE_BULLET_COUNT, type FeatureStory, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { MARKUP } from "@/src/pipeline/draft/validate";

/** The writer's timeout in production (writer.ts). */
export const WRITER_TIMEOUT_MS = 240_000;

/**
 * What one writer run gives. Every metric reads the first draft, except "Checks pass after rewrite". The judge's
 * grade of the first draft is the outcome's `grade`; the times of the writer calls are its `callMs`.
 */
export interface WriterRun {
  first: WrittenIssueContent;
  /** findContentProblems on the first draft. */
  firstProblems: string[];
  /** After production's one rewrite (none when the first draft passed). A failed rewrite is a problem. */
  finalProblems: string[];
}

export type WriterOutcome = Outcome<WriterCase, WriterRun, IssueGrade>;
type Ok = WriterOutcome & { output: WriterRun };

/** The pairwise judge's verdict on one issue: this effort's first draft against the baseline's. */
export type PairResult = "win" | "tie" | "loss";

/** Markdown list or heading marks, which the draft checks' MARKUP (links, tags, bold, code) does not cover. */
const LIST_OR_HEADING = /^\s*(?:[-*•]|#{1,6})\s/m;
const EMOJI = /\p{Extended_Pictographic}/u;
const DASH_OR_ELLIPSIS = /—|…|\.\.\./;

/** Every plain-text field of a draft. */
export function stringFields(content: WrittenIssueContent): string[] {
  const features = [...content.headlines, ...content.research_and_analysis];
  return [
    content.title,
    content.excerpt,
    content.overview.summary,
    ...features.flatMap((item) => [item.headline, item.story_detail, ...item.bullets.flatMap((b) => [b.before, b.highlight, b.after])]),
    ...content.tools.flatMap((item) => [item.link_text, item.detail]),
    ...content.quick_hits.flatMap((item) => [item.link_text, item.text]),
  ];
}

const STOPWORDS = new Set(
  "the and for with that this from into its are was were has have had will can new not but than more also their they them over about which while what when who how all one two use uses used using our your".split(" ")
);

function contentWords(text: string): Set<string> {
  return new Set((text.toLowerCase().match(/[a-z0-9]+/g) ?? []).filter((word) => word.length >= 3 && !STOPWORDS.has(word)));
}

/** Share of a bullet's content words that its story_detail already has: 0 is all new, 1 is all repeated. */
export function bulletOverlap(bullet: FeatureStory["bullets"][number], detail: string): number {
  const words = contentWords(`${bullet.before} ${bullet.highlight} ${bullet.after}`);
  if (words.size === 0) return 1;
  const detailWords = contentWords(detail);
  return [...words].filter((word) => detailWords.has(word)).length / words.size;
}

/** A bullet repeats its story_detail when this share of its content words or more is already there. */
export const REPEAT_OVERLAP = 0.6;

const features = (content: WrittenIssueContent) => [...content.headlines, ...content.research_and_analysis];

/** Counts over parts of each run (stories, bullets). A run that errored counts all its expected parts as misses. */
function countParts(name: string, outcomes: WriterOutcome[], parts: (outcome: WriterOutcome) => boolean[]): Metric {
  const all = outcomes.flatMap(parts);
  return { name, hits: all.filter(Boolean).length, n: all.length };
}

function storiesInPlace(item: WriterCase, content: WrittenIssueContent): boolean {
  return CANDIDATE_SECTION_CONFIGS.every((config) => {
    const want = item.input.sections[config.key].map((story) => story.id);
    const got = content[CONTENT_SECTION_KEYS[config.key]].map((entry) => entry.story_id);
    return want.length === got.length && want.every((id, index) => id === got[index]);
  });
}

function featureCount(item: WriterCase): number {
  return item.input.sections.headlines.length + item.input.sections.research.length;
}

function hasArticleText(item: WriterCase, storyId: number): boolean {
  return (item.input.articles ?? []).some((article) => article.storyId === storyId && "text" in article && article.text.trim() !== "");
}

function codeMetrics(outcomes: WriterOutcome[]): Metric[] {
  const ok = (outcome: WriterOutcome): outcome is Ok => outcome.error === null && outcome.output !== null;
  // Every writer call, failed ones too; a run with no recorded call counts at its own time.
  const writerMs = outcomes.flatMap((outcome) => (outcome.callMs.length ? outcome.callMs : [outcome.latencyMs]));
  return [
    countHits("Valid output", outcomes, () => true),
    countHits("Checks pass, first draft", outcomes, (outcome) => outcome.output.firstProblems.length === 0),
    countHits("Checks pass after rewrite", outcomes, (outcome) => outcome.output.finalProblems.length === 0),
    countHits("Stories in section and order", outcomes, (outcome) => storiesInPlace(outcome.item, outcome.output.first)),
    countParts("Feature items with 3 bullets", outcomes, (outcome) =>
      ok(outcome)
        ? features(outcome.output.first).map((item) => item.bullets.length === FEATURE_BULLET_COUNT)
        : Array(featureCount(outcome.item)).fill(false)
    ),
    countParts("Story detail 2-4 sentences", outcomes, (outcome) =>
      ok(outcome)
        ? features(outcome.output.first).map((item) => {
            const sentences = countSentences(item.story_detail);
            return sentences >= 2 && sentences <= 4;
          })
        : Array(featureCount(outcome.item)).fill(false)
    ),
    countHits("Title 4-8 words", outcomes, (outcome) => {
      const words = countWords(outcome.output.first.title);
      return words >= 4 && words <= 8;
    }),
    countHits("Excerpt 1-2 sentences", outcomes, (outcome) => {
      const sentences = countSentences(outcome.output.first.excerpt);
      return sentences >= 1 && sentences <= 2;
    }),
    countHits("Overview 45-80 words", outcomes, (outcome) => {
      const words = countWords(outcome.output.first.overview.summary);
      return words >= 45 && words <= 80;
    }),
    countHits("Plain text (no markup, URL, emoji)", outcomes, (outcome) =>
      stringFields(outcome.output.first).every((field) => !MARKUP.test(field) && !LIST_OR_HEADING.test(field) && !EMOJI.test(field))
    ),
    countHits("No em dash or ellipsis", outcomes, (outcome) => stringFields(outcome.output.first).every((field) => !DASH_OR_ELLIPSIS.test(field))),
    countParts("Bullets not repeating detail", outcomes, (outcome) =>
      ok(outcome)
        ? features(outcome.output.first).flatMap((item) => item.bullets.map((b) => bulletOverlap(b, item.story_detail) < REPEAT_OVERLAP))
        : Array(featureCount(outcome.item) * FEATURE_BULLET_COUNT).fill(false)
    ),
    {
      name: "Mean bullet overlap with detail",
      value: mean(
        outcomes.filter(ok).flatMap((outcome) => features(outcome.output.first).flatMap((item) => item.bullets.map((b) => bulletOverlap(b, item.story_detail))))
      ),
    },
    countParts("Notes followed (code)", outcomes, (outcome) =>
      withEvalNotes(outcome.item.input).noted.map(({ storyId, note }) => ok(outcome) && note.followed(outcome.output.first, storyId))
    ),
    { name: WRITER_CALLS_IN_TIME, hits: writerMs.filter((ms) => ms < WRITER_TIMEOUT_MS).length, n: writerMs.length },
  ];
}

function judgeMetrics(outcomes: WriterOutcome[]): Metric[] {
  const graded = gradedOutcomes(outcomes).map((outcome) => ({ outcome, grade: outcome.grade }));
  const claims = (grade: IssueGrade) =>
    Math.max(0, grade.intro_unsupported_claims) + grade.stories.reduce((sum, story) => sum + Math.max(0, story.unsupported_claims), 0);
  const bullets = graded.flatMap(({ outcome, grade }) =>
    grade.stories.flatMap((story) => story.bullets.map((bullet) => ({ bullet, read: hasArticleText(outcome.item, story.story_id) })))
  );
  const notes = graded.flatMap(({ outcome, grade }) =>
    withEvalNotes(outcome.item.input).noted.map(({ storyId }) => grade.stories.find((story) => story.story_id === storyId)?.note === "followed")
  );
  const readBullets = bullets.filter((entry) => entry.read);
  return [
    { name: "Unsupported claims per issue (judge)", value: mean(graded.map(({ grade }) => claims(grade))) },
    countGraded("Issues with no unsupported claim (judge)", outcomes, (outcome) => claims(outcome.grade) === 0),
    { name: "Bullets distinct from detail (judge)", hits: bullets.filter((entry) => entry.bullet.distinct_from_detail).length, n: bullets.length },
    { name: "Bullets from article text (judge)", hits: readBullets.filter((entry) => entry.bullet.from_article_text).length, n: readBullets.length },
    { name: "Notes followed (judge)", hits: notes.filter(Boolean).length, n: notes.length },
    { name: "Editorial quality 1-5 (judge)", value: mean(graded.map(({ grade }) => Math.min(5, Math.max(1, grade.editorial_quality)))) },
  ];
}

export function scoreWriter(outcomes: WriterOutcome[]): Metric[] {
  return [...codeMetrics(outcomes), ...judgeMetrics(outcomes)];
}

const WRITER_CALLS_IN_TIME = `Writer calls under ${WRITER_TIMEOUT_MS / 1000} s`;

/** The names of the pairwise metrics against `baseline`. */
export function pairMetricNames(baseline: string) {
  return {
    wins: `Wins vs ${baseline} (pairwise)`,
    ties: `Ties vs ${baseline} (pairwise)`,
    preference: `Preference vs ${baseline} (win + tie/2)`,
  };
}

/** The pairwise metrics of one effort against `baseline`; none when no pair was judged. */
export function pairMetrics(results: PairResult[], baseline: string): Metric[] {
  if (results.length === 0) return [];
  const names = pairMetricNames(baseline);
  const wins = results.filter((result) => result === "win").length;
  const ties = results.filter((result) => result === "tie").length;
  return [
    { name: names.wins, hits: wins, n: results.length },
    { name: names.ties, hits: ties, n: results.length },
    { name: names.preference, value: (wins + ties / 2) / results.length },
  ];
}

/**
 * The results table's columns: the writer gives about 27 metrics, all kept in the stored rows. Rows from before
 * 2026-11-11 timed the judge in p50/p95 and compared each effort with low, so their "Writer p50 s", "Writer max s" and preference
 * columns are kept too; a column no row has is left out.
 */
export function writerColumns(baseline: string): string[] {
  const pair = pairMetricNames(baseline);
  return [
    "Valid output",
    "Checks pass, first draft",
    "Checks pass after rewrite",
    "Stories in section and order",
    "Story detail 2-4 sentences",
    "Overview 45-80 words",
    "Plain text (no markup, URL, emoji)",
    "Bullets not repeating detail",
    "Notes followed (code)",
    WRITER_CALLS_IN_TIME,
    "Unsupported claims per issue (judge)",
    "Issues with no unsupported claim (judge)",
    "Bullets from article text (judge)",
    "Notes followed (judge)",
    "Editorial quality 1-5 (judge)",
    pair.wins,
    pair.preference,
    ...(baseline === "low" ? [] : [pairMetricNames("low").preference]),
    "Writer p50 s",
    "Writer max s",
  ];
}
