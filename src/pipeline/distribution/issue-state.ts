import { draftChangedSinceStaged } from "@/src/pipeline/distribution/staged-version";

/**
 * The state of a date's issue (#149, ADR 0004): one pure function of plain facts. No database and no clock.
 * The board and the 18:00 check both use it. Safe for client components.
 */

export interface IssueStateFacts {
  /** An issue for the date is published. */
  published: boolean;
  /** The issue's newest draft row. Null when the date has no commit, so no draft. */
  newestDraft: { id: number; status: string; title: string | null; featuredImageUrl: string | null } | null;
  /** The issue's newest staged version. */
  newestStaged: { version: number; draftId: number; title: string; featuredImageUrl: string | null } | null;
}

export type IssueState =
  | { kind: "no_outline" }
  | { kind: "drafting" }
  | { kind: "draft_failed" }
  | { kind: "draft_ready" }
  /** `changedSinceStaged`: the current draft differs from the newest staged version (row, title, or image). */
  | { kind: "staged"; version: number; changedSinceStaged: boolean }
  | { kind: "published" };

export function issueState(facts: IssueStateFacts): IssueState {
  if (facts.published) return { kind: "published" };
  const draft = facts.newestDraft;
  if (!draft) return { kind: "no_outline" };
  if (draft.status === "failed") return { kind: "draft_failed" };
  if (draft.status !== "ready") return { kind: "drafting" };
  const staged = facts.newestStaged;
  if (!staged) return { kind: "draft_ready" };
  return {
    kind: "staged",
    version: staged.version,
    changedSinceStaged: draftChangedSinceStaged({ draftId: draft.id, title: draft.title ?? "", featuredImageUrl: draft.featuredImageUrl }, staged),
  };
}

const TEXT: Record<Exclude<IssueState["kind"], "staged">, string> = {
  no_outline: "No outline",
  drafting: "Drafting",
  draft_failed: "Draft failed",
  draft_ready: "Draft ready",
  published: "Published",
};

/** The state in the owner's words, e.g. "Staged, v2". */
export function issueStateText(state: IssueState): string {
  return state.kind === "staged" ? `Staged, v${state.version}` : TEXT[state.kind];
}

/** "The draft changed after v2 was staged.", or null when it did not. */
export function stagedChangeNote(state: IssueState): string | null {
  return state.kind === "staged" && state.changedSinceStaged ? stagedChangeText(state.version) : null;
}

export function stagedChangeText(version: number): string {
  return `The draft changed after v${version} was staged.`;
}
