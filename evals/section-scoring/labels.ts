/**
 * The label logic of the golden-set labeling page (#177): key press → new session state → export. Pure, with no
 * imports, so the page builder can bundle it into the page and the tests can run it with no browser.
 *
 * Keys: Enter saves the draft and goes to the next story (on an untouched draft, that confirms the recommendation).
 * g, r, t, n pick the kind. Shift+G, R, T mark "also fits". 1 to 5 set the importance. e toggles "either is fine".
 * / opens the reason box. Escape closes it. ArrowLeft or Backspace goes back. ArrowRight goes forward over a
 * labeled story.
 */

/** "general" is the Top Stories kind: general AI news. "none" is not a story (an ad, a roundup, not about AI). */
export type Kind = "general" | "research" | "tools" | "none";

export const KIND_KEYS: Readonly<Record<string, Kind>> = { g: "general", r: "research", t: "tools", n: "none" };
const ALSO_KEYS: Readonly<Record<string, Kind>> = { G: "general", R: "research", T: "tools" };

/** The scorer's answer, shown to the owner as the starting draft. */
export interface Recommendation {
  kind: Kind;
  /** 1 to 5. */
  importance: number;
}

export interface LabelStory {
  id: number;
  /** hashInput of the story text the owner saw (evals/lib/golden.ts). */
  inputHash: string;
  /** Null when the page hides the recommendation (part of the check set). */
  recommendation: Recommendation | null;
}

/**
 * confirmed: kind and importance match the recommendation. overridden: one of them differs (a reason is required).
 * either: "either is fine", left out of the golden score. unprompted: no recommendation was shown.
 */
export type LabelState = "confirmed" | "overridden" | "either" | "unprompted";

export interface Label {
  kind: Kind;
  /** A second kind that also fits. Never the kind itself, never "none". */
  also: Kind | null;
  /** 1 to 5. Null for "not a story". */
  importance: number | null;
  state: LabelState;
  reason: string;
  /** ISO time. */
  labeledAt: string;
}

export interface Draft {
  kind: Kind | null;
  also: Kind | null;
  importance: number | null;
  either: boolean;
  reason: string;
}

export interface Session {
  stories: LabelStory[];
  /** The current story. Equal to stories.length when every story is done. */
  index: number;
  /** Story id → label. */
  labels: Record<string, Label>;
  draft: Draft;
  askingReason: boolean;
  /** What the owner must do before the draft can be saved. */
  message: string | null;
}

/** What the page keeps in the browser between visits. */
export interface SavedSession {
  index: number;
  labels: Record<string, Label>;
}

export interface LabelExport {
  about: string;
  batch: string;
  scoringVersion: string;
  exportedAt: string;
  labels: { storyId: number; inputHash: string; recommendation: Recommendation | null; label: Label }[];
}

function draftFor(story: LabelStory | undefined, label: Label | undefined): Draft {
  if (label) {
    return { kind: label.kind, also: label.also, importance: label.importance, either: label.state === "either", reason: label.reason };
  }
  const recommendation = story?.recommendation;
  return { kind: recommendation?.kind ?? null, also: null, importance: recommendation?.importance ?? null, either: false, reason: "" };
}

function goTo(session: Session, index: number): Session {
  const story = session.stories[index];
  return {
    ...session,
    index,
    draft: draftFor(story, story && session.labels[story.id]),
    askingReason: false,
    message: null,
  };
}

export function startSession(stories: LabelStory[], saved?: SavedSession): Session {
  const base: Session = {
    stories,
    index: 0,
    labels: saved?.labels ?? {},
    draft: draftFor(undefined, undefined),
    askingReason: false,
    message: null,
  };
  return goTo(base, Math.min(Math.max(saved?.index ?? 0, 0), stories.length));
}

export function remaining(session: Session): number {
  return session.stories.filter((story) => !session.labels[story.id]).length;
}

export function typeReason(session: Session, text: string): Session {
  return { ...session, draft: { ...session.draft, reason: text } };
}

function stateOf(story: LabelStory, draft: Draft): LabelState {
  if (draft.either) return "either";
  const recommendation = story.recommendation;
  if (!recommendation) return "unprompted";
  const sameKind = draft.kind === recommendation.kind;
  return sameKind && (draft.kind === "none" || draft.importance === recommendation.importance) ? "confirmed" : "overridden";
}

function save(session: Session, now: string): Session {
  const story = session.stories[session.index];
  const { draft } = session;
  if (!draft.kind) return { ...session, message: "Pick a kind: g, r, t or n." };
  if (draft.kind !== "none" && draft.importance === null) return { ...session, message: "Set the importance: 1 to 5." };
  const state = stateOf(story, draft);
  if (state === "overridden" && !draft.reason.trim()) {
    return { ...session, askingReason: true, message: "You changed the recommendation. Type a short reason, then Enter." };
  }
  const label: Label = {
    kind: draft.kind,
    also: draft.kind === "none" ? null : draft.also,
    importance: draft.kind === "none" ? null : draft.importance,
    state,
    reason: draft.reason.trim(),
    labeledAt: now,
  };
  return goTo({ ...session, labels: { ...session.labels, [story.id]: label } }, session.index + 1);
}

export function press(session: Session, key: string, now: string): Session {
  const done = session.index >= session.stories.length;
  if (session.askingReason) {
    if (key === "Enter") return save(session, now);
    if (key === "Escape") return { ...session, askingReason: false, message: null };
    return session;
  }
  if (key === "ArrowLeft" || key === "Backspace") return goTo(session, Math.max(session.index - 1, 0));
  if (done) return session;
  const story = session.stories[session.index];
  const draft = session.draft;
  const withDraft = (next: Partial<Draft>): Session => ({ ...session, draft: { ...draft, ...next }, message: null });

  if (key === "Enter") return save(session, now);
  if (key === "ArrowRight") return session.labels[story.id] ? goTo(session, session.index + 1) : session;
  if (key === "/") return { ...session, askingReason: true, message: null };
  if (key === "e") return withDraft({ either: !draft.either });
  if (KIND_KEYS[key]) {
    const kind = KIND_KEYS[key];
    return withDraft({ kind, also: kind === "none" || draft.also === kind ? null : draft.also });
  }
  if (ALSO_KEYS[key]) {
    const also = ALSO_KEYS[key];
    if (also === draft.kind || draft.kind === "none") return withDraft({ also: null });
    return withDraft({ also: draft.also === also ? null : also });
  }
  if (/^[1-5]$/.test(key)) return withDraft({ importance: Number(key) });
  return session;
}

export function exportLabels(session: Session, meta: { batch: string; scoringVersion: string }, now: string): LabelExport {
  return {
    about: "The owner's golden-set labels for section scoring (#177), exported from the labeling page.",
    batch: meta.batch,
    scoringVersion: meta.scoringVersion,
    exportedAt: now,
    labels: session.stories
      .filter((story) => session.labels[story.id])
      .map((story) => ({
        storyId: story.id,
        inputHash: story.inputHash,
        recommendation: story.recommendation,
        label: session.labels[story.id],
      })),
  };
}
