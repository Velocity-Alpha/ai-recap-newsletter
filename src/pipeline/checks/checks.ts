import type { AlertSeverity } from "@/src/pipeline/alerts";
import { ISSUE_PUBLISHED } from "@/src/features/newsletter/issue-status";
import type { DayFacts } from "@/src/pipeline/checks/day-facts";
import { CHECK_TIMES, newYorkClock, WEEKDAY_NAMES, type CheckTime } from "@/src/pipeline/checks/schedule";
import { STORY_SOURCES } from "@/src/pipeline/ingest/sources";

/**
 * The checks (GLOSSARY.md), as pure functions of a day's facts. Each check runs from its own time on, so a
 * later check time re-checks the earlier ones and can resolve their incidents.
 */

export type CheckName = "ingest-run" | "stories-thin" | "source-empty" | "commit" | "draft" | "publish" | "site";

const RUNS_FROM: Record<CheckName, CheckTime> = {
  "ingest-run": "10:05",
  "stories-thin": "10:05",
  "source-empty": "10:05",
  commit: "12:00",
  draft: "18:00",
  publish: "18:00",
  site: "18:00",
};

/** Incident key = `<prefix>:[<source>:]<date>`. The runbook (#85) lists these. */
export const CHECK_INCIDENT_PREFIXES = {
  "ingest-run": "ingest-run-missing",
  "stories-thin": "stories-thin",
  "source-empty": "source-empty",
  commit: "commit-missing",
  draft: "draft-missing",
  publish: "publish-pending",
  site: "site-check-failed",
} as const satisfies Record<CheckName, string>;

/** Under this share of the weekday's 8-week median, the day is thin. */
const THIN_SHARE = 0.5;

export interface SiteFacts {
  issueUrl: string;
  issuePage: { status: number | null; hasTitle: boolean; error?: string };
  homeUrl: string;
  home: { status: number | null; listsIssue: boolean; error?: string };
}

export type Failure = { severity: AlertSeverity; what: string; evidence: string; link: string };
/** `failure` is null when the check passes, which resolves its incident. */
export type Finding = { check: CheckName; incidentKey: string; failure: Failure | null };
/** `notes` are info lines for the run log, e.g. why a check was not judged this time. */
export type CheckOutcome = { status: "skipped" } | { status: "checked"; findings: Finding[]; notes: string[] };

export interface CheckContext {
  /** Read only when the issue is published at 18:00 (needsSiteCheck). */
  site: SiteFacts | null;
  siteUrl: string;
  runLink: string;
}

function isDue(check: CheckName, time: CheckTime): boolean {
  return CHECK_TIMES.indexOf(time) >= CHECK_TIMES.indexOf(RUNS_FROM[check]);
}

function keyFor(check: CheckName, date: string, source?: string): string {
  return [CHECK_INCIDENT_PREFIXES[check], ...(source ? [source] : []), date].join(":");
}

/** The date of a check incident key, or null for any other key. */
export function checkIncidentDate(incidentKey: string): string | null {
  const parts = incidentKey.split(":");
  const date = parts.at(-1) ?? "";
  if (parts.length < 2 || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  return (Object.values(CHECK_INCIDENT_PREFIXES) as string[]).includes(parts[0]) ? date : null;
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function plural(count: number, word: string, many = `${word}s`): string {
  return `${count} ${count === 1 ? word : many}`;
}

export function stories(count: number): string {
  return plural(count, "story", "stories");
}

export function ingestRunNote(facts: DayFacts): string {
  return facts.ingestRun ? `Ingest run ${facts.ingestRun.id}: ${facts.ingestRun.status}.` : "No ingest run today.";
}

function ingestRunCheck(facts: DayFacts, runMissing: boolean, context: CheckContext): Finding {
  const { date } = facts;
  return {
    check: "ingest-run",
    incidentKey: keyFor("ingest-run", date),
    failure: runMissing
      ? {
          severity: "critical",
          what: `No ingest run today (${date}).`,
          evidence: `No ingest-stories run in pipeline_runs since 00:00 New York. ${stories(facts.storyTotal)} ingested on ${date}.`,
          link: context.runLink,
        }
      : null,
  };
}

function thinCheck(facts: DayFacts, context: CheckContext): Finding {
  const { date } = facts;
  const usual = median(facts.weekdayTotals);
  const floor = usual === null ? null : usual * THIN_SHARE;
  const weekday = WEEKDAY_NAMES[facts.weekday];
  // Without history only an empty day is clearly wrong.
  const thin = floor === null ? facts.storyTotal === 0 : facts.storyTotal < floor;
  const usualNote =
    floor === null
      ? `There is no ${weekday} history yet.`
      : `The 8-week ${weekday} median is ${usual}, so the floor is ${floor}.`;
  return {
    check: "stories-thin",
    incidentKey: keyFor("stories-thin", date),
    failure: thin
      ? {
          severity: "critical",
          what:
            facts.storyTotal === 0
              ? "No stories today."
              : `Only ${stories(facts.storyTotal)} today, under half the usual ${weekday}.`,
          evidence: `${stories(facts.storyTotal)} ingested on ${date}. ${usualNote} ${ingestRunNote(facts)}`,
          link: context.runLink,
        }
      : null,
  };
}

function listOf(words: string[]): string {
  return words.length < 2 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words.at(-1)}`;
}

/** Only a source expected on this weekday (`expectedOn` in sources.ts) is warned about. */
function sourceChecks(facts: DayFacts, context: CheckContext): Finding[] {
  const { date } = facts;
  return STORY_SOURCES.map((source) => {
    const empty = (facts.storiesBySource[source.key] ?? 0) === 0;
    const usualDays = listOf(source.expectedOn.map((day) => WEEKDAY_NAMES[day]));
    return {
      check: "source-empty",
      incidentKey: keyFor("source-empty", date, source.key),
      failure:
        empty && source.expectedOn.includes(facts.weekday)
          ? {
              severity: "warning",
              what: `No stories from ${source.name} today.`,
              evidence: `0 stories with source ${source.key} ingested on ${date}. ${source.name} stories usually arrive on ${usualDays}. ${ingestRunNote(facts)}`,
              link: context.runLink,
            }
          : null,
    };
  });
}

/**
 * The 10:05 checks. Two cases are not judged, so their open incidents are neither raised nor resolved:
 * - the ingest run is still running at 10:05 (it can take up to 15 minutes): the story checks wait for 12:00;
 * - no stories or no ingest run: the per-source warnings would only repeat the critical.
 */
function storyChecks(time: CheckTime, facts: DayFacts, context: CheckContext): { findings: Finding[]; notes: string[] } {
  const runMissing = !facts.ingestRun;
  const findings = [ingestRunCheck(facts, runMissing, context)];

  if (time === "10:05" && facts.ingestRun?.status === "running") {
    const note = `Ingest run ${facts.ingestRun.id} is still running at 10:05, so the story total and per-source checks wait until 12:00.`;
    return { findings, notes: [note] };
  }

  findings.push(thinCheck(facts, context));
  if (runMissing || facts.storyTotal === 0) {
    const missing = [runMissing && "no ingest run", facts.storyTotal === 0 && "no stories"].filter(Boolean).join(" and ");
    return { findings, notes: [`${missing[0].toUpperCase()}${missing.slice(1)} today, so the per-source checks are left to the critical.`] };
  }
  return { findings: [...findings, ...sourceChecks(facts, context)], notes: [] };
}

function commitCheck(facts: DayFacts, context: CheckContext): Finding {
  return {
    check: "commit",
    incidentKey: keyFor("commit", facts.date),
    failure: facts.committed
      ? null
      : {
          severity: "warning",
          what: `No commit for ${facts.date} yet.`,
          evidence: `No stories are queued for ${facts.date} and there is no draft. ${stories(facts.storyTotal)} are on the board.`,
          link: `${context.siteUrl}/approval?date=${facts.date}`,
        },
  };
}

function draftCheck(facts: DayFacts, context: CheckContext): Finding {
  const commit = facts.commitTime ? ` (committed about ${newYorkClock(facts.commitTime)} New York)` : "";
  return {
    check: "draft",
    incidentKey: keyFor("draft", facts.date),
    failure:
      facts.committed && !facts.draftReady
        ? {
            severity: "critical",
            what: `Committed, but no draft is ready for ${facts.date}.`,
            evidence: `${stories(facts.queuedStories)} queued for ${facts.date}${commit}. ${plural(facts.draftsMade, "draft")}, none with email HTML.`,
            link: `${context.siteUrl}/approval/issues`,
          }
        : null,
  };
}

function publishCheck(facts: DayFacts, context: CheckContext): Finding {
  const issue = facts.issue;
  return {
    check: "publish",
    incidentKey: keyFor("publish", facts.date),
    failure:
      facts.draftReady && issue && issue.status !== ISSUE_PUBLISHED
        ? {
            severity: "warning",
            what: `The draft for ${facts.date} is ready but not published.`,
            evidence: `Issue ${issue.id} ("${issue.title}") is still a draft at 18:00. Send it from GHL, or mark it published.`,
            link: `${context.siteUrl}/approval/issues`,
          }
        : null,
  };
}

function siteProblems(issue: NonNullable<DayFacts["issue"]>, site: SiteFacts | null): string[] {
  if (!site) return [`The site was not checked${issue.slug ? "" : ": the issue has no slug"}.`];
  const problems: string[] = [];
  const page = site.issuePage;
  if (page.error) problems.push(`The issue page ${site.issueUrl} could not be read: ${page.error}.`);
  else if (page.status !== 200) problems.push(`The issue page ${site.issueUrl} returned HTTP ${page.status}.`);
  else if (!page.hasTitle) problems.push(`The issue page ${site.issueUrl} does not contain the title "${issue.title}".`);
  const home = site.home;
  if (home.error) problems.push(`The home page could not be read: ${home.error}.`);
  else if (home.status !== 200) problems.push(`The home page returned HTTP ${home.status}.`);
  else if (!home.listsIssue) problems.push(`The home page does not list /issue/${issue.slug}.`);
  return problems;
}

function siteCheck(facts: DayFacts, context: CheckContext): Finding {
  const issue = facts.issue;
  const problems = issue?.status === ISSUE_PUBLISHED ? siteProblems(issue, context.site) : [];
  return {
    check: "site",
    incidentKey: keyFor("site", facts.date),
    failure:
      issue && problems.length > 0
        ? {
            severity: "critical",
            what: `The published issue for ${facts.date} is not right on the site.`,
            evidence: problems.join(" "),
            link: context.site?.issueUrl ?? `${context.siteUrl}/approval/issues`,
          }
        : null,
  };
}

/** True when this check time needs the public site: 18:00, with a published issue. */
export function needsSiteCheck(time: CheckTime, facts: DayFacts): boolean {
  return !facts.skipped && isDue("site", time) && facts.issue?.status === ISSUE_PUBLISHED;
}

/** Runs every check due at `time`. A skipped date runs none. */
export function evaluateChecks(time: CheckTime, facts: DayFacts, context: CheckContext): CheckOutcome {
  if (facts.skipped) return { status: "skipped" };
  const { findings, notes } = storyChecks(time, facts, context);
  if (isDue("commit", time)) findings.push(commitCheck(facts, context));
  if (isDue("draft", time)) {
    findings.push(draftCheck(facts, context), publishCheck(facts, context), siteCheck(facts, context));
  }
  return { status: "checked", findings, notes };
}
