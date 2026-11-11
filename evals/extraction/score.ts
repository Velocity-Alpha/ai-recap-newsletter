import type { ExtractionGolden, GoldenStory } from "@/evals/extraction/golden";
import type { ExtractionGrade, StoryVerdict } from "@/evals/extraction/judge";
import type { Metric } from "@/evals/lib/results";
import { mean } from "@/evals/lib/stats";
import { countHits, gradedOutcomes, type Outcome } from "@/evals/lib/sweep";
import { STORY_CATEGORIES, type ExtractedStory, type StoryCategory } from "@/src/pipeline/ingest/extract";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

/** What one extraction run gives: the stories. The judge's grade is the outcome's `grade`. */
export interface ExtractionOutput {
  stories: ExtractedStory[];
}

type ExtractionOutcome<I> = Outcome<I, ExtractionOutput, ExtractionGrade>;

/** The fields of an issue scoring needs. */
export interface ScoredIssue {
  text: string;
  /** The issue's own page: stories linking to its site are not saved (like beehiiv's own host in production). */
  url: string;
  referenceCount: number | null;
  referenceUrls: string[];
  /** The issue's golden value (golden.ts). */
  golden: ExtractionGolden;
}

export interface DeterministicChecks {
  /** Stories with a url that is not a link in the text (compared cleaned, so tracking params do not matter). */
  urlsNotInText: number;
  /** Of those, stories whose page (host and path) is not in the text either: a made-up or broken link, not a dropped query. */
  pagesNotInText: number;
  badCategories: number;
  /** Stories that repeat an earlier story's cleaned url or headline. */
  duplicates: number;
}

const LINK = /https?:\/\/[^\s<>()[\]"']+/g;

/** Every link in the text, cleaned the way ingestion cleans story urls. */
export function urlsInText(text: string): Set<string> {
  return new Set((text.match(LINK) ?? []).map((raw) => cleanStoryUrl(raw.replace(/[.,;:!?]+$/, ""))).filter(Boolean));
}

/** Host and path, without a trailing slash: the page a link opens, whatever its query. */
export function pageKey(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.host.toLowerCase().replace(/^www\./, "")}${parsed.pathname.replace(/\/+$/, "")}`;
  } catch {
    return url;
  }
}

const headlineKey = (headline: string) => headline.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export function checkExtraction(text: string, stories: ExtractedStory[]): DeterministicChecks {
  const links = urlsInText(text);
  const pages = new Set([...links].map(pageKey));
  const seenUrls = new Set<string>();
  const seenHeadlines = new Set<string>();
  let urlsNotInText = 0;
  let pagesNotInText = 0;
  let duplicates = 0;
  for (const story of stories) {
    const url = cleanStoryUrl(story.url);
    if (url && !links.has(url)) urlsNotInText += 1;
    if (url && !pages.has(pageKey(url))) pagesNotInText += 1;
    const headline = headlineKey(story.headline);
    if ((url && seenUrls.has(url)) || seenHeadlines.has(headline)) duplicates += 1;
    if (url) seenUrls.add(url);
    seenHeadlines.add(headline);
  }
  const badCategories = stories.filter((story) => !STORY_CATEGORIES.includes(story.category as StoryCategory)).length;
  return { urlsNotInText, pagesNotInText, badCategories, duplicates };
}

function host(url: string): string {
  try {
    return new URL(url).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

/** The cleaned urls production would save: not empty, not on the newsletter's own site, one per url. */
export function linkedStoryUrls(stories: ExtractedStory[], issueUrl: string): string[] {
  const own = host(issueUrl);
  const urls = stories.map((story) => cleanStoryUrl(story.url)).filter((url) => url && host(url) !== own);
  return [...new Set(urls)];
}

/** One extracted story of a graded run, its verdict, and the golden story it is matched to (story kind only). */
interface Judged {
  story: ExtractedStory;
  verdict: StoryVerdict;
  golden: GoldenStory | null;
}
type Matched = Judged & { golden: GoldenStory };

/** A count over the stories of every graded run. */
function storyHits<T extends Judged>(name: string, judged: T[], test: (entry: T) => boolean): Metric {
  return { name, hits: judged.filter(test).length, n: judged.length };
}

/** The golden story numbers a run found: those an extracted story is matched to as a story or a roundup item. */
export function foundGolden(golden: ExtractionGolden, verdicts: StoryVerdict[]): Set<number> {
  const found = new Set<number>();
  for (const verdict of verdicts) {
    if (verdict.kind !== "story" && verdict.kind !== "roundup_item") continue;
    for (const number of verdict.golden) if (number >= 1 && number <= golden.stories.length) found.add(number);
  }
  return found;
}

/** Golden stories with a url that some extracted story has (both cleaned): recall by link, with no judge. */
function goldenUrlsFound(golden: ExtractionGolden, stories: ExtractedStory[]): { hits: number; n: number } {
  const urls = new Set(stories.map((story) => cleanStoryUrl(story.url)).filter(Boolean));
  const wanted = golden.stories.map((story) => cleanStoryUrl(story.url)).filter(Boolean);
  return { hits: wanted.filter((url) => urls.has(url)).length, n: wanted.length };
}

export function scoreExtraction<I extends ScoredIssue>(outcomes: ExtractionOutcome<I>[]): Metric[] {
  const ok = outcomes.filter((outcome): outcome is ExtractionOutcome<I> & { output: ExtractionOutput } => outcome.error === null && outcome.output !== null);
  const checks = new Map(ok.map((outcome) => [outcome, checkExtraction(outcome.item.text, outcome.output.stories)]));
  const check = (outcome: ExtractionOutcome<I>) => checks.get(outcome as never)!;
  // An error is a miss: no stories.
  const byUrl = outcomes.map((outcome) => goldenUrlsFound(outcome.item.golden, outcome.error === null && outcome.output ? outcome.output.stories : []));

  const metrics: Metric[] = [
    countHits("Valid output", outcomes, () => true),
    countHits("Issues: all story URLs in text", outcomes, (outcome) => check(outcome).urlsNotInText === 0),
    countHits("Issues: all story pages in text", outcomes, (outcome) => check(outcome).pagesNotInText === 0),
    countHits("Issues: categories allowed", outcomes, (outcome) => check(outcome).badCategories === 0),
    countHits("Issues: no duplicates", outcomes, (outcome) => check(outcome).duplicates === 0),
    { name: "Stories per issue", value: mean(ok.map((outcome) => outcome.output.stories.length)) },
    { name: "Golden per issue", value: mean(outcomes.map((outcome) => outcome.item.golden.stories.length)) },
    { name: "Golden URLs found", hits: byUrl.reduce((sum, count) => sum + count.hits, 0), n: byUrl.reduce((sum, count) => sum + count.n, 0) },
    { name: "Saved per issue", value: mean(ok.map((outcome) => linkedStoryUrls(outcome.output.stories, outcome.item.url).length)) },
  ];

  const withReference = outcomes.filter((outcome) => outcome.item.referenceCount !== null);
  if (withReference.length > 0) {
    const okWithReference = ok.filter((outcome) => outcome.item.referenceCount !== null);
    const saved = okWithReference.reduce((sum, outcome) => sum + linkedStoryUrls(outcome.output.stories, outcome.item.url).length, 0);
    const reference = okWithReference.reduce((sum, outcome) => sum + (outcome.item.referenceCount ?? 0), 0);
    let found = 0;
    let total = 0;
    for (const outcome of withReference) {
      const urls = new Set(outcome.output && outcome.error === null ? linkedStoryUrls(outcome.output.stories, outcome.item.url) : []);
      total += outcome.item.referenceUrls.length;
      found += outcome.item.referenceUrls.filter((url) => urls.has(url)).length;
    }
    metrics.push(
      { name: "Dev DB per issue", value: mean(withReference.map((outcome) => outcome.item.referenceCount ?? 0)) },
      { name: "Saved vs dev DB", value: reference ? saved / reference : 0 },
      { name: "Dev DB URLs found", hits: found, n: total }
    );
  }

  const graded = gradedOutcomes(outcomes);
  if (graded.length > 0) {
    const judged: Judged[] = graded.flatMap((outcome) => {
      const golden = outcome.item.golden.stories;
      const verdicts = new Map(outcome.grade.stories.map((verdict) => [verdict.index, verdict]));
      return outcome.output.stories.flatMap((story, index) => {
        const verdict = verdicts.get(index + 1);
        if (!verdict) return [];
        const match = verdict.kind === "story" && verdict.golden.length === 1 ? (golden[verdict.golden[0] - 1] ?? null) : null;
        return [{ story, verdict, golden: match }];
      });
    });
    // A roundup returned as one story per item is right too: its items count neither for nor against precision.
    const counted = judged.filter(({ verdict }) => verdict.kind !== "roundup_item");
    const matched = judged.filter((entry): entry is Matched => entry.golden !== null);
    const found = graded.map((outcome) => foundGolden(outcome.item.golden, outcome.grade.stories).size);
    const goldenTotal = graded.reduce((sum, outcome) => sum + outcome.item.golden.stories.length, 0);
    metrics.push(
      { name: "Recall (golden)", hits: found.reduce((sum, count) => sum + count, 0), n: goldenTotal },
      storyHits("Precision (golden)", counted, ({ verdict }) => verdict.kind === "story"),
      storyHits("Category = golden", matched, ({ story, golden }) => story.category === golden.category),
      storyHits("Importance within 1 of golden", matched, ({ story, golden }) => Math.abs(story.importance_score - golden.importance) <= 1),
      storyHits("URL = golden", matched, ({ story, golden }) => cleanStoryUrl(story.url) === cleanStoryUrl(golden.url)),
      storyHits("Faithful stories", judged, ({ verdict }) => verdict.unsupported_facts === 0),
      storyHits("Headline rules", judged, ({ verdict }) => verdict.headline_ok),
      { name: "Missed per issue", value: mean(graded.map((outcome, index) => outcome.item.golden.stories.length - found[index])) },
      { name: "Extra per issue", value: mean(graded.map((outcome) => outcome.grade.stories.filter((verdict) => verdict.kind === "extra").length)) }
    );
  }
  return metrics;
}
