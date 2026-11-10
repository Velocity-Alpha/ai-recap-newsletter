import { describe, expect, it, vi } from "vitest";

import type { StageReply } from "@/src/features/newsletter/draft-edit-client";
import { DraftRequestError, normalizeTitle } from "@/src/features/newsletter/draft-links";
import {
  chooseImage,
  confirmVersionFor,
  INITIAL_STAGE_STATE,
  initialNewImageState,
  initialTitleState,
  newImageReducer,
  saveTitle,
  shownStaged,
  stageDraft,
  stageReducer,
  titleIsDirty,
  titleReducer,
  type NewImageEvent,
  type NewImageState,
  type StageEvent,
  type StageState,
  type TitleEvent,
  type TitleState,
} from "@/src/features/newsletter/draft-view-state";
import type { StagedSummary } from "@/src/pipeline/draft/draft-board";

const SAVED = "Pretend Lab Ships Planner";
const TYPED = "Pretend Lab Ships a Planner";
const EDITED_AT = "2026-05-21T14:30:00.000Z";
const IMAGE = { imageUrl: "https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-05-21-new222.jpg", scenePrompt: "A pretend lighthouse." };
const REFUSED = new DraftRequestError("The issue for 2026-05-21 (id 3) is already published.", 409);

const STAGED_REPLY: StageReply = {
  kind: "staged",
  staged: { version: 3, serviceName: "GHL", serviceUrl: "https://preview.example.test/v3", mode: "sent", stagedAt: "2026-05-21T14:20:00.000Z" },
};
const V3: StagedSummary = { version: 3, stagedAt: "2026-05-21T14:20:00.000Z", serviceName: "GHL", serviceUrl: "https://preview.example.test/v3" };

/** Runs a control's events through its reducer, as `useReducer` does, and counts the reloads. */
function harness<State, Event>(reducer: (state: State, event: Event) => State, initial: State) {
  const io = {
    state: initial,
    events: [] as Event[],
    onChanged: vi.fn(),
    dispatch(event: Event) {
      io.events.push(event);
      io.state = reducer(io.state, event);
    },
  };
  return io;
}

describe("normalizeTitle", () => {
  it("makes one trimmed line, as the server stores a title", () => {
    expect(normalizeTitle("  Pretend   Lab\nShips\tPlanner  ")).toBe("Pretend Lab Ships Planner");
    expect(normalizeTitle("   ")).toBe("");
  });
});

describe("the title field", () => {
  const title = () => harness<TitleState, TitleEvent>(titleReducer, initialTitleState(SAVED));

  it("starts from the draft's title, with nothing to save", () => {
    expect(initialTitleState(SAVED)).toEqual({ value: SAVED, saved: SAVED, busy: false, error: null });
    expect(titleIsDirty(initialTitleState(SAVED))).toBe(false);
  });

  it("is dirty once the typed title differs from the saved one", () => {
    expect(titleIsDirty(titleReducer(initialTitleState(SAVED), { type: "typed", value: TYPED }))).toBe(true);
    expect(titleIsDirty({ value: "", saved: SAVED })).toBe(true);
  });

  it("does not count white space as a change, in what was typed or in the saved title", () => {
    expect(titleIsDirty({ value: "  Pretend   Lab Ships\tPlanner  ", saved: SAVED })).toBe(false);
    // A title saved before titles were cleaned: "Save" must not show on load.
    expect(titleIsDirty(initialTitleState(" Pretend Lab  Ships Planner "))).toBe(false);
    expect(titleIsDirty({ value: SAVED, saved: " Pretend Lab  Ships Planner " })).toBe(false);
  });

  it("goes back to the saved title on Cancel, and drops the error", () => {
    const state = titleReducer({ value: TYPED, saved: SAVED, busy: false, error: "Use a different title." }, { type: "cancelled" });

    expect(state).toEqual({ value: SAVED, saved: SAVED, busy: false, error: null });
  });

  it("saves the title: busy, then the title as the server stored it, then the draft is read again", async () => {
    const io = title();
    io.dispatch({ type: "typed", value: `  ${TYPED} ` });
    const request = vi.fn(async () => {
      expect(io.state).toMatchObject({ busy: true, error: null });
      return TYPED;
    });

    await saveTitle(41, io.state.value, { ...io, request });

    expect(request).toHaveBeenCalledWith(41, `  ${TYPED} `);
    expect(io.state).toEqual({ value: TYPED, saved: TYPED, busy: false, error: null });
    expect(titleIsDirty(io.state)).toBe(false);
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("keeps what the owner typed and shows the reason when the save fails, without a reload", async () => {
    const io = title();
    io.dispatch({ type: "typed", value: TYPED });
    const taken = new DraftRequestError("The title is 240 characters. Keep it to 200 or fewer.", 400);

    await saveTitle(41, TYPED, { ...io, request: vi.fn(async () => Promise.reject(taken)) });

    expect(io.state).toEqual({ value: TYPED, saved: SAVED, busy: false, error: taken.message });
    expect(titleIsDirty(io.state)).toBe(true);
    expect(io.onChanged).not.toHaveBeenCalled();
  });

  it("reads the draft again after a refusal (409), so the page shows why the draft cannot change", async () => {
    const io = title();

    await saveTitle(41, TYPED, { ...io, request: vi.fn(async () => Promise.reject(REFUSED)) });

    expect(io.state).toMatchObject({ busy: false, error: REFUSED.message });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("clears an old error when the next save starts, and uses a plain fallback for an unknown failure", async () => {
    const io = title();
    io.dispatch({ type: "failed", error: "An old error." });
    const request = vi.fn(async () => {
      expect(io.state.error).toBeNull();
      return Promise.reject("not an error");
    });

    await saveTitle(41, TYPED, { ...io, request });

    expect(io.state.error).toBe("Could not change the title.");
    expect(io.onChanged).not.toHaveBeenCalled();
  });
});

describe("Stage for sending", () => {
  const stage = (initial: StageState = INITIAL_STAGE_STATE) => harness<StageState, StageEvent>(stageReducer, initial);
  const DRAFT = { id: 41, editedAt: null };
  const already = (version: number) => vi.fn(async (): Promise<StageReply> => ({ kind: "already_staged", version }));

  it("stages the draft: busy, then the staged version as the page's own, then the draft is read again", async () => {
    const io = stage();
    const request = vi.fn(async () => {
      expect(io.state).toMatchObject({ busy: true, error: null });
      return STAGED_REPLY;
    });

    await stageDraft(DRAFT, false, { ...io, request });

    expect(request).toHaveBeenCalledWith(41, false);
    expect(io.state).toEqual({ busy: false, confirm: null, error: null, justStaged: { staged: V3, recorded: false } });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("marks a staging made outside production as recorded", async () => {
    const io = stage();
    const recorded: StageReply = { kind: "staged", staged: { ...STAGED_REPLY.staged, serviceUrl: null, mode: "recorded" } };

    await stageDraft(DRAFT, false, { ...io, request: vi.fn(async () => recorded) });

    expect(io.state.justStaged).toEqual({ staged: { ...V3, serviceUrl: null }, recorded: true });
  });

  it("asks before it stages an unchanged draft again, then stages it on the owner's yes", async () => {
    const io = stage();

    await stageDraft(DRAFT, false, { ...io, request: already(2) });

    expect(io.state).toEqual({ busy: false, confirm: { version: 2, editedAt: null }, error: null, justStaged: null });
    expect(confirmVersionFor(io.state.confirm, DRAFT.editedAt)).toBe(2);
    // Nothing changed on the server, so nothing to read again.
    expect(io.onChanged).not.toHaveBeenCalled();

    const request = vi.fn(async () => {
      // The question stays up while the yes is staged.
      expect(io.state).toMatchObject({ busy: true, confirm: { version: 2 } });
      return STAGED_REPLY;
    });
    await stageDraft(DRAFT, true, { ...io, request });

    expect(request).toHaveBeenCalledWith(41, true);
    expect(io.state).toEqual({ busy: false, confirm: null, error: null, justStaged: { staged: V3, recorded: false } });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("drops the question on Cancel, and keeps everything else", () => {
    const asked: StageState = { busy: false, confirm: { version: 2, editedAt: null }, error: null, justStaged: { staged: V3, recorded: true } };

    expect(stageReducer(asked, { type: "cancelled" })).toEqual({ ...asked, confirm: null });
  });

  it("drops the question once the draft has changed since: a new title or image makes it untrue", async () => {
    const io = stage();
    await stageDraft({ id: 41, editedAt: null }, false, { ...io, request: already(2) });

    expect(confirmVersionFor(io.state.confirm, null)).toBe(2);
    expect(confirmVersionFor(io.state.confirm, EDITED_AT)).toBeNull();

    const later = stage();
    await stageDraft({ id: 41, editedAt: EDITED_AT }, false, { ...later, request: already(2) });

    expect(confirmVersionFor(later.state.confirm, EDITED_AT)).toBe(2);
    expect(confirmVersionFor(later.state.confirm, "2026-05-21T15:00:00.000Z")).toBeNull();
    expect(confirmVersionFor(null, null)).toBeNull();
  });

  it("shows the reason and drops the question when a staging fails, without a reload", async () => {
    const io = stage({ ...INITIAL_STAGE_STATE, confirm: { version: 2, editedAt: null }, justStaged: { staged: V3, recorded: false } });
    const failure = new DraftRequestError("Staging failed: the distribution service answered HTTP 401.", 502);

    await stageDraft(DRAFT, true, { ...io, request: vi.fn(async () => Promise.reject(failure)) });

    expect(io.state).toEqual({ busy: false, confirm: null, error: failure.message, justStaged: { staged: V3, recorded: false } });
    expect(io.onChanged).not.toHaveBeenCalled();
  });

  it("reads the draft again after a refusal (409): published, not the newest draft, or not ready", async () => {
    const io = stage();

    await stageDraft(DRAFT, false, { ...io, request: vi.fn(async () => Promise.reject(REFUSED)) });

    expect(io.state).toMatchObject({ busy: false, error: REFUSED.message });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("clears the error when the next staging starts and when it works", async () => {
    const io = stage({ ...INITIAL_STAGE_STATE, error: "An old error." });
    const request = vi.fn(async () => {
      expect(io.state.error).toBeNull();
      return STAGED_REPLY;
    });

    await stageDraft(DRAFT, false, { ...io, request });

    expect(io.state.error).toBeNull();
  });

  it("uses a plain fallback for an unknown failure", async () => {
    const io = stage();

    await stageDraft(DRAFT, false, { ...io, request: vi.fn(async () => Promise.reject(undefined)) });

    expect(io.state.error).toBe("Could not stage the draft.");
  });

  describe("shownStaged: the page's own staging, or the draft's", () => {
    const mine = { staged: { ...V3, serviceUrl: null }, recorded: true };

    it("shows the draft's staged version, as sent, when the page staged nothing", () => {
      expect(shownStaged(V3, null)).toEqual({ staged: V3, recorded: false });
      expect(shownStaged(null, null)).toEqual({ staged: null, recorded: false });
    });

    it("shows the page's own while the draft read shows nothing or an older version", () => {
      expect(shownStaged(null, mine)).toBe(mine);
      expect(shownStaged({ ...V3, version: 2 }, mine)).toBe(mine);
    });

    it("keeps the page's own at the same version, so the recorded note stays", () => {
      expect(shownStaged(V3, mine)).toBe(mine);
    });

    it("shows the draft's once it has a newer staged version than the page made", () => {
      const v4 = { ...V3, version: 4 };

      expect(shownStaged(v4, mine)).toEqual({ staged: v4, recorded: false });
    });
  });
});

describe("New image", () => {
  const OLD_SCENE = "A pretend robot at a desk.";
  const panel = (initial: NewImageState = initialNewImageState(OLD_SCENE)) => harness<NewImageState, NewImageEvent>(newImageReducer, initial);
  const generated = (): NewImageState => ({ open: true, scene: "A scene edited after Generate.", generated: IMAGE, busy: null, error: null });

  it("starts closed, with the draft's scene prompt in the box", () => {
    expect(initialNewImageState(OLD_SCENE)).toEqual({ open: false, scene: OLD_SCENE, generated: null, busy: null, error: null });
    expect(initialNewImageState(null).scene).toBe("");
  });

  it("opens and closes, keeping the scene and the generated image", () => {
    const open = newImageReducer(generated(), { type: "closed" });

    expect(open).toEqual({ ...generated(), open: false });
    expect(newImageReducer(open, { type: "opened" })).toEqual(generated());
  });

  it("generates: busy, then the image, with the old error gone", () => {
    const io = panel({ ...initialNewImageState(OLD_SCENE), open: true, error: "An old error." });

    io.dispatch({ type: "scene_changed", scene: IMAGE.scenePrompt });
    io.dispatch({ type: "generating" });
    expect(io.state).toMatchObject({ scene: IMAGE.scenePrompt, busy: "generate", error: null });
    io.dispatch({ type: "generated", image: IMAGE });
    expect(io.state).toMatchObject({ busy: null, generated: IMAGE, open: true });
  });

  it("uses the image: busy, then closed with the saved scene prompt in the box, then the draft is read again", async () => {
    const io = panel(generated());
    const request = vi.fn(async () => {
      expect(io.state).toMatchObject({ busy: "choose", error: null, open: true });
    });

    await chooseImage(41, IMAGE, { ...io, request });

    expect(request).toHaveBeenCalledWith(41, IMAGE);
    // Reopening shows the scene the draft now has, not the one it had on load or a later edit of the box.
    expect(io.state).toEqual({ open: false, scene: IMAGE.scenePrompt, generated: null, busy: null, error: null });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("stays open with the image and shows the reason when the save fails, without a reload", async () => {
    const io = panel(generated());
    const failure = new DraftRequestError("The image was not saved.", 500);

    await chooseImage(41, IMAGE, { ...io, request: vi.fn(async () => Promise.reject(failure)) });

    expect(io.state).toEqual({ ...generated(), error: failure.message });
    expect(io.onChanged).not.toHaveBeenCalled();
  });

  it("reads the draft again after a refusal (409)", async () => {
    const io = panel(generated());

    await chooseImage(41, IMAGE, { ...io, request: vi.fn(async () => Promise.reject(REFUSED)) });

    expect(io.state).toMatchObject({ busy: null, error: REFUSED.message });
    expect(io.onChanged).toHaveBeenCalledTimes(1);
  });

  it("uses a plain fallback for an unknown failure", async () => {
    const io = panel(generated());

    await chooseImage(41, IMAGE, { ...io, request: vi.fn(async () => Promise.reject(null)) });

    expect(io.state.error).toBe("Something went wrong. Try again.");
  });
});
