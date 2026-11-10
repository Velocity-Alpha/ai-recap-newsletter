/**
 * Staged versions (GLOSSARY.md, ADR 0005): the pure rules. No database and no clock.
 */

/** The parts of a draft, and of a staged version's copy, that tell the two apart. */
export interface StagedComparison {
  draftId: number;
  title: string;
  featuredImageUrl: string | null;
}

/**
 * True when the current draft differs from a staged version: a different draft row, a different title, or a
 * different image URL. Staging an unchanged draft again needs the owner's yes.
 */
export function draftChangedSinceStaged(draft: StagedComparison, staged: StagedComparison): boolean {
  return draft.draftId !== staged.draftId || draft.title !== staged.title || (draft.featuredImageUrl ?? "") !== (staged.featuredImageUrl ?? "");
}

/** `<YYYY-MM-DD> v<version>: <title>`, the name the owner sees in the distribution service. */
export function stagedEmailName(input: { issueDate: string; version: number; title: string }): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) {
    throw new Error(`Issue date "${input.issueDate}" must be YYYY-MM-DD.`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`Version ${input.version} must be a whole number from 1.`);
  }
  const title = input.title.replace(/\s+/g, " ").trim();
  if (!title) throw new Error("The title is empty.");
  return `${input.issueDate} v${input.version}: ${title}`;
}

/** The incident a failed staging raises. `run-checks` closes it when its day is over (checks.ts). */
export const STAGE_INCIDENT_PREFIX = "stage.failed";

export function stageIncidentKey(date: string): string {
  return `${STAGE_INCIDENT_PREFIX}:${date}`;
}
