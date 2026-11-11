import type { ExtractionGrade, StoryVerdict } from "@/evals/extraction/judge";
import type { Metric } from "@/evals/lib/results";
import { countHits, type Outcome } from "@/evals/lib/sweep";
import { STORY_CATEGORIES, type ExtractedStory, type StoryCategory } from "@/src/pipeline/ingest/extract";
import { cleanStoryUrl } from "@/src/pipeline/ingest/url";

/** What one extraction run gives: the stories, and the judge's grade (null when the judge failed). */
export interface ExtractionOutput {
  stories: ExtractedStory[];
  grade: ExtractionGrade | null;
}

/** The fields of an issue scoring needs. */
export interface ScoredIssue {
  text: string;
  /** The issue's own page: stories linking to its site are not saved (like beehiiv's own host in production). */
  url: string;
  referenceCount: number | null;
  referenceUrls: string[];
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

const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/** A count over the stories of every graded run. */
function storyHits(name: string, pairs: { story: ExtractedStory; verdict: StoryVerdict }[], test: (story: ExtractedStory, verdict: StoryVerdict) => boolean): Metric {
  return { name, hits: pairs.filter(({ story, verdict }) => test(story, verdict)).length, n: pairs.length };
}

export function scoreExtraction<I extends ScoredIssue>(outcomes: Outcome<I, ExtractionOutput>[]): Metric[] {
  const ok = outcomes.filter((outcome): outcome is Outcome<I, ExtractionOutput> & { output: ExtractionOutput } => outcome.error === null && outcome.output !== null);
  const checks = new Map(ok.map((outcome) => [outcome, checkExtraction(outcome.item.text, outcome.output.stories)]));
  const check = (outcome: Outcome<I, ExtractionOutput>) => checks.get(outcome as never)!;

  const metrics: Metric[] = [
    countHits("Valid output", outcomes, () => true),
    countHits("Issues: all story URLs in text", outcomes, (outcome) => check(outcome).urlsNotInText === 0),
    countHits("Issues: all story pages in text", outcomes, (outcome) => check(outcome).pagesNotInText === 0),
    countHits("Issues: categories allowed", outcomes, (outcome) => check(outcome).badCategories === 0),
    countHits("Issues: no duplicates", outcomes, (outcome) => check(outcome).duplicates === 0),
    { name: "Stories per issue", value: mean(ok.map((outcome) => outcome.output.stories.length)) },
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

  const graded = ok.filter((outcome) => outcome.output.grade !== null);
  if (graded.length > 0) {
    const pairs = graded.flatMap((outcome) => {
      const verdicts = new Map(outcome.output.grade!.stories.map((verdict) => [verdict.index, verdict]));
      return outcome.output.stories.flatMap((story, index) => {
        const verdict = verdicts.get(index + 1);
        return verdict ? [{ story, verdict }] : [];
      });
    });
    const real = pairs.filter(({ verdict }) => verdict.kind === "story");
    const qualifying = graded.reduce((sum, outcome) => sum + outcome.output.grade!.qualifying_in_text, 0);
    const missed = graded.reduce((sum, outcome) => sum + Math.min(outcome.output.grade!.missed, outcome.output.grade!.qualifying_in_text), 0);
    metrics.push(
      countHits("Graded runs", outcomes, (outcome) => outcome.output.grade !== null),
      { name: "Recall (judge)", hits: qualifying - missed, n: qualifying },
      storyHits("Precision (judge)", pairs, (_, verdict) => verdict.kind === "story"),
      storyHits("Faithful stories", pairs, (_, verdict) => verdict.unsupported_facts === 0),
      storyHits("Category right", real, (story, verdict) => story.category === verdict.expected_category),
      storyHits("Headline rules", pairs, (_, verdict) => verdict.headline_ok),
      storyHits("URL right", pairs, (_, verdict) => verdict.url_ok),
      storyHits("Importance within 1", real, (story, verdict) => Math.abs(story.importance_score - verdict.expected_importance) <= 1),
      { name: "Missed per issue", value: mean(graded.map((outcome) => outcome.output.grade!.missed)) }
    );
  }
  return metrics;
}
