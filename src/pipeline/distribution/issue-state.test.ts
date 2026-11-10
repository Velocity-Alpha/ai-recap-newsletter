import { describe, expect, it } from "vitest";

import { issueState, issueStateText, stagedChangeNote, type IssueStateFacts } from "@/src/pipeline/distribution/issue-state";

const DRAFT = { id: 41, status: "ready", title: "Pretend Lab Plans A Week", featuredImageUrl: "https://assets.example.test/a.jpg" } as const;
const STAGED = { version: 2, draftId: 41, title: DRAFT.title, featuredImageUrl: DRAFT.featuredImageUrl } as const;

function facts(overrides: Partial<IssueStateFacts> = {}): IssueStateFacts {
  return { published: false, newestDraft: { ...DRAFT }, newestStaged: null, ...overrides };
}

describe("issueState", () => {
  it("is no_outline when the date has no draft", () => {
    const state = issueState(facts({ newestDraft: null }));
    expect(state).toEqual({ kind: "no_outline" });
    expect(issueStateText(state)).toBe("No outline");
  });

  it("is drafting while the newest draft runs, also when an earlier draft was staged", () => {
    const state = issueState(facts({ newestDraft: { ...DRAFT, id: 42, status: "running" }, newestStaged: { ...STAGED } }));
    expect(state).toEqual({ kind: "drafting" });
    expect(issueStateText(state)).toBe("Drafting");
  });

  it("is draft_failed when the newest draft failed", () => {
    const state = issueState(facts({ newestDraft: { ...DRAFT, status: "failed" } }));
    expect(state).toEqual({ kind: "draft_failed" });
    expect(issueStateText(state)).toBe("Draft failed");
  });

  it("is draft_ready when the newest draft is ready and nothing is staged", () => {
    const state = issueState(facts());
    expect(state).toEqual({ kind: "draft_ready" });
    expect(issueStateText(state)).toBe("Draft ready");
  });

  it("is staged, with the version, when the ready draft is the one that was staged", () => {
    const state = issueState(facts({ newestStaged: { ...STAGED } }));
    expect(state).toEqual({ kind: "staged", version: 2, changedSinceStaged: false });
    expect(issueStateText(state)).toBe("Staged, v2");
    expect(stagedChangeNote(state)).toBeNull();
  });

  it("is published once the issue is published, whatever the drafts say", () => {
    for (const status of ["running", "failed", "ready"] as const) {
      const state = issueState(facts({ published: true, newestDraft: { ...DRAFT, status }, newestStaged: { ...STAGED } }));
      expect(state).toEqual({ kind: "published" });
      expect(issueStateText(state)).toBe("Published");
    }
    expect(issueState(facts({ published: true, newestDraft: null }))).toEqual({ kind: "published" });
  });

  describe("changedSinceStaged", () => {
    it("is true when a different draft row is current", () => {
      const state = issueState(facts({ newestDraft: { ...DRAFT, id: 42 }, newestStaged: { ...STAGED } }));
      expect(state).toEqual({ kind: "staged", version: 2, changedSinceStaged: true });
      expect(stagedChangeNote(state)).toBe("The draft changed after v2 was staged.");
    });

    it("is true when the title is different", () => {
      const state = issueState(facts({ newestDraft: { ...DRAFT, title: "Pretend Lab Plans A Month" }, newestStaged: { ...STAGED } }));
      expect(state).toEqual({ kind: "staged", version: 2, changedSinceStaged: true });
    });

    it("is true when the image URL is different", () => {
      const state = issueState(facts({ newestDraft: { ...DRAFT, featuredImageUrl: "https://assets.example.test/b.jpg" }, newestStaged: { ...STAGED } }));
      expect(state).toEqual({ kind: "staged", version: 2, changedSinceStaged: true });
    });
  });

  it("gives no change note for a state that is not staged", () => {
    expect(stagedChangeNote(issueState(facts()))).toBeNull();
  });
});
