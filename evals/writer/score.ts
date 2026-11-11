import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countGraded, countHits, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { countSentences, countWords } from "@/evals/lib/text";
import type { WriterCase } from "@/evals/writer/dataset";
import { withEvalNotes } from "@/evals/writer/notes";
import type { IssueGrade, PairGrade } from "@/evals/writer/rubric";
import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";
import { CONTENT_SECTION_KEYS, FEATURE_BULLET_COUNT, type FeatureStory, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { MARKUP } from "@/src/pipeline/draft/validate";
import {
  EXCERPT_SENTENCES,
  OVERVIEW_WORDS,
  STORY_DETAIL_SENTENCES,
  TITLE_WORDS,
  WRITER_TIMEOUT_MS,
} from "@/src/pipeline/draft/writer";

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

/** The pairwise judge's verdict on one issue: the run's first draft against the golden issue. */
export type PairResult = "win" | "tie" | "loss";

export interface GoldenVerdict {
  result: PairResult;
  /** Whether the run's draft was DRAFT A (the golden issue was B). */
  draftFirst: boolean;
}

/** The judge's two grades of a run: the faithfulness grade against the source, and the verdict against golden. */
export interface WriterGrade {
  issue: IssueGrade;
  /** Null when the pairwise judge failed; the faithfulness grade still counts. */
  vsGolden: GoldenVerdict | null;
}

export type WriterOutcome = Outcome<WriterCase, WriterRun, WriterGrade>;
type Ok = WriterOutcome & { output: WriterRun };

/** The run's result from the pairwise judge's answer, given which side the run's draft was on. */
export function pairResult(winner: PairGrade["winner"], draftFirst: boolean): PairResult {
  if (winner === "tie") return "tie";
  return (winner === "A") === draftFirst ? "win" : "loss";
}

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

const within = (value: number, range: { min: number; max: number }) => value >= range.min && value <= range.max;

/** The code checks of a whole draft, by metric name, with the writer's own limits (writer.ts). */
const ISSUE_CHECKS: Array<{ name: string; pass: (item: WriterCase, content: WrittenIssueContent) => boolean }> = [
  { name: "Stories in section and order", pass: storiesInPlace },
  { name: `Title ${TITLE_WORDS.min}-${TITLE_WORDS.max} words`, pass: (_, content) => within(countWords(content.title), TITLE_WORDS) },
  {
    name: `Excerpt ${EXCERPT_SENTENCES.min}-${EXCERPT_SENTENCES.max} sentences`,
    pass: (_, content) => within(countSentences(content.excerpt), EXCERPT_SENTENCES),
  },
  {
    name: `Overview ${OVERVIEW_WORDS.min}-${OVERVIEW_WORDS.max} words`,
    pass: (_, content) => within(countWords(content.overview.summary), OVERVIEW_WORDS),
  },
  {
    name: "Plain text (no markup, URL, emoji)",
    pass: (_, content) => stringFields(content).every((field) => !MARKUP.test(field) && !LIST_OR_HEADING.test(field) && !EMOJI.test(field)),
  },
  { name: "No em dash or ellipsis", pass: (_, content) => stringFields(content).every((field) => !DASH_OR_ELLIPSIS.test(field)) },
];

/** The code checks of each feature item, by metric name. */
const FEATURE_CHECKS: Array<{ name: string; pass: (item: FeatureStory) => boolean }> = [
  { name: `Feature items with ${FEATURE_BULLET_COUNT} bullets`, pass: (item) => item.bullets.length === FEATURE_BULLET_COUNT },
  {
    name: `Story detail ${STORY_DETAIL_SENTENCES.min}-${STORY_DETAIL_SENTENCES.max} sentences`,
    pass: (item) => within(countSentences(item.story_detail), STORY_DETAIL_SENTENCES),
  },
];

const NOT_REPEATING = "Bullets not repeating detail";
const NOTES_CODE = "Notes followed (code)";
const WRITER_CALLS_IN_TIME = `Writer calls under ${WRITER_TIMEOUT_MS / 1000} s`;

const repeatsDetail = (bullet: FeatureStory["bullets"][number], detail: string) => bulletOverlap(bullet, detail) >= REPEAT_OVERLAP;

/** The code checks a draft fails, by name (with the story id for per-story checks). The golden issue must pass them all. */
export function draftCheckFailures(item: WriterCase, content: WrittenIssueContent): string[] {
  const issue = ISSUE_CHECKS.filter((check) => !check.pass(item, content)).map((check) => check.name);
  const perStory = features(content).flatMap((story) => [
    ...FEATURE_CHECKS.filter((check) => !check.pass(story)).map((check) => `${check.name}: story ${story.story_id}`),
    ...(story.bullets.some((b) => repeatsDetail(b, story.story_detail)) ? [`${NOT_REPEATING}: story ${story.story_id}`] : []),
  ]);
  const notes = withEvalNotes(item.input)
    .noted.filter(({ storyId, note }) => !note.followed(content, storyId))
    .map(({ storyId, note }) => `${NOTES_CODE}: story ${storyId} ("${note.note}")`);
  return [...issue, ...perStory, ...notes];
}

function codeMetrics(outcomes: WriterOutcome[]): Metric[] {
  const ok = (outcome: WriterOutcome): outcome is Ok => outcome.error === null && outcome.output !== null;
  // Every writer call, failed ones too; a run with no recorded call counts at its own time.
  const writerMs = outcomes.flatMap((outcome) => (outcome.callMs.length ? outcome.callMs : [outcome.latencyMs]));
  const [inPlace, ...textChecks] = ISSUE_CHECKS.map((check) =>
    countHits(check.name, outcomes, (outcome) => check.pass(outcome.item, outcome.output.first))
  );
  const featureChecks = FEATURE_CHECKS.map((check) =>
    countParts(check.name, outcomes, (outcome) =>
      ok(outcome) ? features(outcome.output.first).map(check.pass) : Array(featureCount(outcome.item)).fill(false)
    )
  );
  return [
    countHits("Valid output", outcomes, () => true),
    countHits("Checks pass, first draft", outcomes, (outcome) => outcome.output.firstProblems.length === 0),
    countHits("Checks pass after rewrite", outcomes, (outcome) => outcome.output.finalProblems.length === 0),
    inPlace,
    ...featureChecks,
    ...textChecks,
    countParts(NOT_REPEATING, outcomes, (outcome) =>
      ok(outcome)
        ? features(outcome.output.first).flatMap((item) => item.bullets.map((b) => !repeatsDetail(b, item.story_detail)))
        : Array(featureCount(outcome.item) * FEATURE_BULLET_COUNT).fill(false)
    ),
    {
      name: "Mean bullet overlap with detail",
      value: mean(
        outcomes.filter(ok).flatMap((outcome) => features(outcome.output.first).flatMap((item) => item.bullets.map((b) => bulletOverlap(b, item.story_detail))))
      ),
    },
    countParts(NOTES_CODE, outcomes, (outcome) =>
      withEvalNotes(outcome.item.input).noted.map(({ storyId, note }) => ok(outcome) && note.followed(outcome.output.first, storyId))
    ),
    { name: WRITER_CALLS_IN_TIME, hits: writerMs.filter((ms) => ms < WRITER_TIMEOUT_MS).length, n: writerMs.length },
  ];
}

function judgeMetrics(outcomes: WriterOutcome[]): Metric[] {
  const graded = gradedOutcomes(outcomes).map((outcome) => ({ outcome, grade: outcome.grade.issue }));
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
    countGraded("Issues with no unsupported claim (judge)", outcomes, (outcome) => claims(outcome.grade.issue) === 0),
    { name: "Bullets distinct from detail (judge)", hits: bullets.filter((entry) => entry.bullet.distinct_from_detail).length, n: bullets.length },
    { name: "Bullets from article text (judge)", hits: readBullets.filter((entry) => entry.bullet.from_article_text).length, n: readBullets.length },
    { name: "Notes followed (judge)", hits: notes.filter(Boolean).length, n: notes.length },
    { name: "Editorial quality 1-5 (judge)", value: mean(graded.map(({ grade }) => Math.min(5, Math.max(1, grade.editorial_quality)))) },
  ];
}

/** The names of the pairwise metrics against `other` ("golden"; older rows: an effort). */
export function pairMetricNames(other: string) {
  return {
    wins: `Wins vs ${other} (pairwise)`,
    ties: `Ties vs ${other} (pairwise)`,
    losses: `Losses vs ${other} (pairwise)`,
    preference: `Preference vs ${other} (win + tie/2)`,
  };
}

export const GOLDEN = "golden";

/**
 * Each run's first draft against the golden issue. A run that errored is a loss, as it is a miss in every count;
 * a graded run whose pairwise judge failed is left out. None when no run was compared.
 */
function goldenMetrics(outcomes: WriterOutcome[]): Metric[] {
  const verdicts = gradedOutcomes(outcomes).flatMap((outcome) => (outcome.grade.vsGolden ? [outcome.grade.vsGolden.result] : []));
  if (verdicts.length === 0) return [];
  const errors = outcomes.filter((outcome) => outcome.error !== null).map((): PairResult => "loss");
  const results = [...verdicts, ...errors];
  const names = pairMetricNames(GOLDEN);
  const count = (result: PairResult) => results.filter((entry) => entry === result).length;
  return [
    { name: names.wins, hits: count("win"), n: results.length },
    { name: names.ties, hits: count("tie"), n: results.length },
    { name: names.losses, hits: count("loss"), n: results.length },
    { name: names.preference, value: (count("win") + count("tie") / 2) / results.length },
  ];
}

export function scoreWriter(outcomes: WriterOutcome[]): Metric[] {
  return [...codeMetrics(outcomes), ...judgeMetrics(outcomes), ...goldenMetrics(outcomes)];
}

/** The results table's columns: the writer gives about 30 metrics, all kept in the stored rows. */
export function writerColumns(): string[] {
  const golden = pairMetricNames(GOLDEN);
  return [
    "Valid output",
    "Checks pass, first draft",
    "Checks pass after rewrite",
    "Stories in section and order",
    `Story detail ${STORY_DETAIL_SENTENCES.min}-${STORY_DETAIL_SENTENCES.max} sentences`,
    `Overview ${OVERVIEW_WORDS.min}-${OVERVIEW_WORDS.max} words`,
    "Plain text (no markup, URL, emoji)",
    NOT_REPEATING,
    NOTES_CODE,
    WRITER_CALLS_IN_TIME,
    "Unsupported claims per issue (judge)",
    "Issues with no unsupported claim (judge)",
    "Bullets from article text (judge)",
    "Notes followed (judge)",
    "Editorial quality 1-5 (judge)",
    golden.wins,
    golden.ties,
    golden.preference,
  ];
}
