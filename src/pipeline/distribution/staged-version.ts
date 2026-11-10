/**
 * Staged versions (GLOSSARY.md, ADR 0004): the pure rules. No database and no clock.
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
