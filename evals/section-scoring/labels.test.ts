import { describe, expect, it } from "vitest";

import {
  exportLabels,
  press,
  remaining,
  startSession,
  typeReason,
  type LabelStory,
  type Session,
} from "@/evals/section-scoring/labels";

const NOW = "2026-11-13T10:00:00.000Z";
const stories: LabelStory[] = [
  { id: 11, inputHash: "h11", recommendation: { kind: "general", importance: 3 } },
  { id: 12, inputHash: "h12", recommendation: { kind: "tools", importance: 2 } },
  { id: 13, inputHash: "h13", recommendation: null },
];

/** Presses the keys in order. A key of the form "type:<text>" types a reason. */
function run(keys: string[], session: Session = startSession(stories)): Session {
  return keys.reduce(
    (state, key) => (key.startsWith("type:") ? typeReason(state, key.slice(5)) : press(state, key, NOW)),
    session,
  );
}

describe("startSession", () => {
  it("starts at the first story with the recommendation as the draft", () => {
    const session = startSession(stories);
    expect(session.index).toBe(0);
    expect(session.draft).toMatchObject({ kind: "general", importance: 3, also: null, either: false });
    expect(remaining(session)).toBe(3);
  });

  it("starts with an empty draft when no recommendation is shown", () => {
    const session = startSession(stories, { index: 2, labels: {} });
    expect(session.draft).toMatchObject({ kind: null, importance: null });
  });

  it("continues a saved session at the saved story", () => {
    const first = run(["Enter"]);
    const resumed = startSession(stories, { index: first.index, labels: first.labels });
    expect(resumed.index).toBe(1);
    expect(remaining(resumed)).toBe(2);
  });
});

describe("press", () => {
  it("confirms the recommendation with one key and moves to the next story", () => {
    const session = run(["Enter"]);
    expect(session.labels["11"]).toEqual({
      kind: "general",
      also: null,
      importance: 3,
      state: "confirmed",
      reason: "",
      labeledAt: NOW,
    });
    expect(session.index).toBe(1);
    expect(session.draft).toMatchObject({ kind: "tools", importance: 2 });
  });

  it("asks for a reason on an override, and saves the label only with one", () => {
    const asking = run(["r", "4", "Enter"]);
    expect(asking.askingReason).toBe(true);
    expect(asking.index).toBe(0);
    expect(asking.labels["11"]).toBeUndefined();

    const empty = press(asking, "Enter", NOW);
    expect(empty.index).toBe(0);
    expect(empty.message).toMatch(/reason/i);

    const done = run(["type:a benchmark paper", "Enter"], asking);
    expect(done.labels["11"]).toMatchObject({ kind: "research", importance: 4, state: "overridden", reason: "a benchmark paper" });
    expect(done.index).toBe(1);
    expect(done.askingReason).toBe(false);
  });

  it("counts a changed importance alone as an override", () => {
    expect(run(["5", "Enter"]).askingReason).toBe(true);
  });

  it("goes back to the choice from the reason box with Escape, keeping the draft", () => {
    const session = run(["r", "Enter", "Escape"]);
    expect(session.askingReason).toBe(false);
    expect(session.draft.kind).toBe("research");
  });

  it("ignores other keys while the reason box is open, since they are text", () => {
    const session = run(["r", "Enter", "t", "1"]);
    expect(session.draft).toMatchObject({ kind: "research", importance: 3 });
  });

  it("marks a second kind as 'also fits' with Shift, with no reason needed when kind and importance match", () => {
    const session = run(["T", "Enter"]);
    expect(session.labels["11"]).toMatchObject({ kind: "general", also: "tools", state: "confirmed" });
  });

  it("toggles 'also fits' off, and clears it when it becomes the kind", () => {
    expect(run(["T", "T"]).draft.also).toBeNull();
    expect(run(["T", "t"]).draft).toMatchObject({ kind: "tools", also: null });
    expect(run(["G"]).draft.also).toBeNull();
  });

  it("saves 'either is fine' with no reason", () => {
    const session = run(["r", "e", "Enter"]);
    expect(session.labels["11"]).toMatchObject({ kind: "research", state: "either", reason: "" });
    expect(session.index).toBe(1);
  });

  it("gives 'not a story' no importance and drops 'also fits'", () => {
    const session = run(["T", "n", "Enter", "type:an ad", "Enter"]);
    expect(session.labels["11"]).toMatchObject({ kind: "none", importance: null, also: null, state: "overridden" });
  });

  it("confirms 'not a story' when the scorer said so, whatever the importance", () => {
    const junk = startSession([{ id: 1, inputHash: "h", recommendation: { kind: "none", importance: 2 } }]);
    expect(run(["Enter"], junk).labels["1"]).toMatchObject({ kind: "none", importance: null, state: "confirmed" });
  });

  it("lets the owner add a note with / on a confirm", () => {
    const session = run(["/", "type:fine but dull", "Enter"]);
    expect(session.labels["11"]).toMatchObject({ state: "confirmed", reason: "fine but dull" });
  });

  it("needs a kind and an importance when no recommendation is shown, and asks for no reason", () => {
    const at13 = startSession(stories, { index: 2, labels: {} });
    expect(press(at13, "Enter", NOW).message).toMatch(/kind/i);
    expect(run(["r", "Enter"], at13).message).toMatch(/importance/i);
    const done = run(["r", "2", "Enter"], at13);
    expect(done.labels["13"]).toMatchObject({ kind: "research", importance: 2, state: "unprompted" });
    expect(done.index).toBe(3);
    expect(remaining(done)).toBe(2);
  });

  it("goes back to the previous story with its label as the draft, and a change replaces the label", () => {
    const back = run(["Enter", "ArrowLeft"]);
    expect(back.index).toBe(0);
    expect(back.draft).toMatchObject({ kind: "general", importance: 3 });
    const changed = run(["e", "Enter"], back);
    expect(changed.labels["11"].state).toBe("either");
    expect(Object.keys(changed.labels)).toEqual(["11"]);
  });

  it("does not go back before the first story", () => {
    expect(run(["Backspace"]).index).toBe(0);
  });

  it("moves forward without a change only over a story that has a label", () => {
    expect(run(["ArrowRight"]).index).toBe(0);
    expect(run(["Enter", "ArrowLeft", "r", "ArrowRight"]).index).toBe(1);
    expect(run(["Enter", "ArrowLeft", "r", "ArrowRight"]).labels["11"].kind).toBe("general");
  });
});

describe("exportLabels", () => {
  it("exports every label in story order, with the recommendation it was given", () => {
    const session = run(["Enter", "n", "Enter", "type:a roundup", "Enter", "t", "1", "Enter"]);
    const file = exportLabels(session, { batch: "tuning-1", scoringVersion: "abc" }, NOW);
    expect(file).toMatchObject({ batch: "tuning-1", scoringVersion: "abc", exportedAt: NOW });
    expect(file.labels.map((entry) => entry.storyId)).toEqual([11, 12, 13]);
    expect(file.labels[1]).toMatchObject({
      inputHash: "h12",
      recommendation: { kind: "tools", importance: 2 },
      label: { kind: "none", state: "overridden", reason: "a roundup" },
    });
    expect(file.labels[2].recommendation).toBeNull();
  });

  it("leaves out stories with no label", () => {
    const file = exportLabels(run(["Enter"]), { batch: "tuning-1", scoringVersion: "abc" }, NOW);
    expect(file.labels).toHaveLength(1);
  });
});
