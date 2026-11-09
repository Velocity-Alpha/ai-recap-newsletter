import type { Alert } from "@/src/generated/prisma";
import { ingestRunNote, median, stories } from "@/src/pipeline/checks/checks";
import type { DayFacts } from "@/src/pipeline/checks/day-facts";
import { newYorkClock, WEEKDAY_NAMES } from "@/src/pipeline/checks/schedule";
import { STORY_SOURCES } from "@/src/pipeline/ingest/sources";

/** The 18:00 daily summary for the ops chat (#52). Plain text, like the alerts. It goes out on skipped dates too. */

export type SummaryIncident = Pick<Alert, "incidentKey" | "severity" | "message" | "firstSeen">;

function storyLines(facts: DayFacts): string[] {
  const usual = median(facts.weekdayTotals);
  const header = `Stories: ${facts.storyTotal}${usual === null ? "" : ` (8-week ${WEEKDAY_NAMES[facts.weekday]} median ${usual})`}. ${ingestRunNote(facts)}`;
  const known = new Set(STORY_SOURCES.map((source) => source.key));
  const others = Object.entries(facts.storiesBySource).filter(([key]) => !known.has(key));
  return [
    header,
    ...STORY_SOURCES.map((source) => `- ${source.name}: ${facts.storiesBySource[source.key] ?? 0}`),
    ...others.map(([key, count]) => `- ${key}: ${count}`),
  ];
}

function issueLines(facts: DayFacts): string[] {
  const commit = facts.committed
    ? `Commit: ${facts.commitTime ? `about ${newYorkClock(facts.commitTime)}` : "yes"} (${stories(facts.queuedStories)} queued).`
    : "Commit: none.";
  const drafts =
    facts.draftsMade === 0 ? "Drafts: none." : `Drafts: ${facts.draftsMade} made, ${facts.draftReady ? "ready" : "none ready"}.`;
  const published = facts.issue?.publishedAt
    ? `Published: ${newYorkClock(facts.issue.publishedAt)}, "${facts.issue.title}".`
    : "Published: no.";
  return [commit, drafts, published];
}

function incidentLines(open: SummaryIncident[], info: SummaryIncident[]): string[] {
  const lines =
    open.length === 0
      ? ["Open incidents: none."]
      : [`Open incidents (${open.length}):`, ...open.map((alert) => `- ${alert.severity.toUpperCase()} ${alert.incidentKey}: ${alert.message}`)];
  if (info.length > 0) {
    lines.push(`Info incidents (${info.length}):`, ...info.map((alert) => `- ${alert.incidentKey}: ${alert.message}`));
  }
  return lines;
}

export function buildDailySummary(input: {
  facts: DayFacts;
  openIncidents: SummaryIncident[];
  infoIncidents: SummaryIncident[];
}): string {
  const { facts } = input;
  const skipped = facts.skipped
    ? [`Skipped date: no issue today${facts.skipped.note ? ` (${facts.skipped.note})` : ""}. Checks are off.`]
    : [];
  return [
    `Daily summary: ${WEEKDAY_NAMES[facts.weekday]} ${facts.date}`,
    ...skipped,
    "",
    ...storyLines(facts),
    ...issueLines(facts),
    "",
    ...incidentLines(input.openIncidents, input.infoIncidents),
    "",
    "Times are New York.",
  ].join("\n");
}
