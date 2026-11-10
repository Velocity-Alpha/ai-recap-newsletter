import { requestStage, requestTitleChange, type StageReply } from "@/src/features/newsletter/draft-edit-client";
import { isRefusal, normalizeTitle } from "@/src/features/newsletter/draft-links";
import { requestUseImage } from "@/src/features/newsletter/new-image-client";
import type { StagedSummary } from "@/src/pipeline/draft/draft-board";
import type { FeaturedImage } from "@/src/pipeline/draft/image/featured-image";

/**
 * The state of the draft view's three controls (#149): the title field, "New image", and "Stage for sending".
 * Each has a pure reducer, and one function that makes the server call and reports each step. The components
 * only render the state. Safe for client components.
 *
 * After a change the page reads the draft again (`onChanged`). It does the same after a refusal (HTTP 409: the
 * issue is published, a newer draft exists, or the draft is not ready), so the page stops showing a draft that
 * can no longer be changed as if it could.
 */

function messageOf(reason: unknown, fallback: string): string {
  return reason instanceof Error && reason.message ? reason.message : fallback;
}

// ---- The title field ----

export interface TitleState {
  /** What the field shows. */
  value: string;
  /** The title the draft has now. */
  saved: string;
  busy: boolean;
  error: string | null;
}

export type TitleEvent =
  | { type: "typed"; value: string }
  | { type: "cancelled" }
  | { type: "saving" }
  | { type: "saved"; title: string }
  | { type: "failed"; error: string };

export function initialTitleState(title: string): TitleState {
  return { value: title, saved: title, busy: false, error: null };
}

export function titleReducer(state: TitleState, event: TitleEvent): TitleState {
  switch (event.type) {
    case "typed":
      return { ...state, value: event.value };
    case "cancelled":
      return { ...state, value: state.saved, error: null };
    case "saving":
      return { ...state, busy: true, error: null };
    case "saved":
      return { value: event.title, saved: event.title, busy: false, error: null };
    case "failed":
      return { ...state, busy: false, error: event.error };
  }
}

/**
 * The field holds a title that is not saved. Both sides are normalised, so a saved title with double or edge
 * spaces does not count as a change on load.
 */
export function titleIsDirty(state: Pick<TitleState, "value" | "saved">): boolean {
  return normalizeTitle(state.value) !== normalizeTitle(state.saved);
}

export interface ControlIo<Event> {
  dispatch: (event: Event) => void;
  /** Reads the draft again. */
  onChanged?: () => void;
}

/** "Save" on the title field. */
export async function saveTitle(
  draftId: number,
  value: string,
  io: ControlIo<TitleEvent> & { request?: typeof requestTitleChange },
): Promise<void> {
  io.dispatch({ type: "saving" });
  try {
    const title = await (io.request ?? requestTitleChange)(draftId, value);
    io.dispatch({ type: "saved", title });
    io.onChanged?.();
  } catch (reason) {
    io.dispatch({ type: "failed", error: messageOf(reason, "Could not change the title.") });
    if (isRefusal(reason)) io.onChanged?.();
  }
}

// ---- "Stage for sending" ----

/** A staging this page made. `recorded` outside production: nothing reached the distribution service. */
export interface JustStaged {
  staged: StagedSummary;
  recorded: boolean;
}

/** The server's "this staged version already holds the draft", and the draft's edit time when it said so. */
export interface StageConfirm {
  version: number;
  editedAt: string | null;
}

export interface StageState {
  busy: boolean;
  confirm: StageConfirm | null;
  error: string | null;
  justStaged: JustStaged | null;
}

export type StageEvent =
  | { type: "staging" }
  /** `editedAt` is the draft's edit time when the request was made. */
  | { type: "replied"; reply: StageReply; editedAt: string | null }
  | { type: "failed"; error: string }
  | { type: "cancelled" };

export const INITIAL_STAGE_STATE: StageState = { busy: false, confirm: null, error: null, justStaged: null };

export function stageReducer(state: StageState, event: StageEvent): StageState {
  switch (event.type) {
    case "staging":
      // The question stays up while the owner's yes is staged, so its button can say "Staging…".
      return { ...state, busy: true, error: null };
    case "replied": {
      if (event.reply.kind === "already_staged") {
        return { ...state, busy: false, confirm: { version: event.reply.version, editedAt: event.editedAt } };
      }
      const { version, stagedAt, serviceName, serviceUrl, mode } = event.reply.staged;
      return {
        busy: false,
        confirm: null,
        error: null,
        justStaged: { staged: { version, stagedAt, serviceName, serviceUrl }, recorded: mode === "recorded" },
      };
    }
    case "failed":
      return { ...state, busy: false, confirm: null, error: event.error };
    case "cancelled":
      return { ...state, confirm: null };
  }
}

/**
 * The staged version the "stage it again?" question names. Null once the draft has changed since the server
 * said so (a new title or image): the question is then no longer true, so it goes away.
 */
export function confirmVersionFor(confirm: StageConfirm | null, editedAt: string | null): number | null {
  return confirm && confirm.editedAt === editedAt ? confirm.version : null;
}

/**
 * Which staged version the panel shows. The page's own staging, while the draft as last read shows no staged
 * version, an older one, or the same one: only the page's own copy knows whether it was `recorded`. The draft's,
 * once it shows a newer staged version than the page made.
 */
export function shownStaged(draftStaged: StagedSummary | null, justStaged: JustStaged | null): { staged: StagedSummary | null; recorded: boolean } {
  if (justStaged && (!draftStaged || draftStaged.version <= justStaged.staged.version)) return justStaged;
  return { staged: draftStaged, recorded: false };
}

/** "Stage for sending", or "Stage it again" with `confirmRepeat`. */
export async function stageDraft(
  draft: { id: number; editedAt: string | null },
  confirmRepeat: boolean,
  io: ControlIo<StageEvent> & { request?: typeof requestStage },
): Promise<void> {
  io.dispatch({ type: "staging" });
  try {
    const reply = await (io.request ?? requestStage)(draft.id, confirmRepeat);
    io.dispatch({ type: "replied", reply, editedAt: draft.editedAt });
    if (reply.kind === "staged") io.onChanged?.();
  } catch (reason) {
    io.dispatch({ type: "failed", error: messageOf(reason, "Could not stage the draft.") });
    if (isRefusal(reason)) io.onChanged?.();
  }
}

// ---- "New image" ----

export interface NewImageState {
  open: boolean;
  /** The scene prompt in the box. */
  scene: string;
  /** The image "Generate" made, not yet in the draft. */
  generated: FeaturedImage | null;
  busy: "generate" | "choose" | null;
  error: string | null;
}

export type NewImageEvent =
  | { type: "opened" }
  | { type: "closed" }
  | { type: "scene_changed"; scene: string }
  | { type: "generating" }
  | { type: "generated"; image: FeaturedImage }
  | { type: "choosing" }
  | { type: "chosen"; image: FeaturedImage }
  | { type: "failed"; error: string };

export function initialNewImageState(scenePrompt: string | null): NewImageState {
  return { open: false, scene: scenePrompt ?? "", generated: null, busy: null, error: null };
}

export function newImageReducer(state: NewImageState, event: NewImageEvent): NewImageState {
  switch (event.type) {
    case "opened":
      return { ...state, open: true };
    case "closed":
      return { ...state, open: false };
    case "scene_changed":
      return { ...state, scene: event.scene };
    case "generating":
      return { ...state, busy: "generate", error: null };
    case "generated":
      return { ...state, busy: null, generated: event.image };
    case "choosing":
      return { ...state, busy: "choose", error: null };
    case "chosen":
      // The box starts again from the scene prompt the draft now has, not from the one it had on load.
      return { open: false, scene: event.image.scenePrompt, generated: null, busy: null, error: null };
    case "failed":
      return { ...state, busy: null, error: event.error };
  }
}

/** "Use this image". The image's own scene goes with it, even if the box was edited after "Generate". */
export async function chooseImage(
  draftId: number,
  image: FeaturedImage,
  io: ControlIo<NewImageEvent> & { request?: typeof requestUseImage },
): Promise<void> {
  io.dispatch({ type: "choosing" });
  try {
    await (io.request ?? requestUseImage)(draftId, image);
    io.dispatch({ type: "chosen", image });
    io.onChanged?.();
  } catch (reason) {
    io.dispatch({ type: "failed", error: messageOf(reason, "Something went wrong. Try again.") });
    if (isRefusal(reason)) io.onChanged?.();
  }
}
