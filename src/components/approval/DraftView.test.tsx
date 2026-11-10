import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import DraftView from "@/src/components/approval/DraftView";
import type { DraftBoardView, DraftStepView } from "@/src/pipeline/draft/draft-board";

const STEPS: Array<[DraftStepView["key"], string]> = [
  ["load", "loading the outline"],
  ["read_articles", "reading articles"],
  ["write", "writing"],
  ["validate", "checking the writing"],
  ["image", "making the image"],
  ["html", "building the email"],
  ["save", "saving the draft"],
];
const ALL_DONE: DraftStepView["state"][] = Array(STEPS.length).fill("done");

function steps(states: DraftStepView["state"][]): DraftStepView[] {
  return STEPS.map(([key, label], index) => ({ key, label, state: states[index] ?? "waiting" }));
}

function draft(data: Partial<DraftBoardView> = {}): DraftBoardView {
  return {
    id: 41,
    issueId: 3,
    issueDate: "2026-05-21",
    version: 2,
    status: "running",
    subject: null,
    stepLabel: "writing",
    failedStep: null,
    failedStepLabel: null,
    error: null,
    steps: steps(["done", "done", "current"]),
    hasHtml: false,
    unreadStories: [],
    retryable: false,
    editable: false,
    issuePublished: false,
    hasNewerDraft: false,
    featuredImageUrl: null,
    scenePrompt: null,
    editedAt: null,
    staged: null,
    createdAt: "2026-05-21T14:00:00.000Z",
    startedAt: "2026-05-21T14:00:01.000Z",
    finishedAt: null,
    ...data,
  };
}

/** A ready draft. `editable` says whether it is the issue's current draft. */
function ready(data: Partial<DraftBoardView> = {}): DraftBoardView {
  return draft({
    status: "ready",
    subject: "Pretend Lab Ships Planner",
    stepLabel: null,
    steps: steps(ALL_DONE),
    hasHtml: true,
    editable: true,
    finishedAt: "2026-05-21T14:01:10.000Z",
    ...data,
  });
}

function render(view: DraftBoardView, retry: { busy?: boolean; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <DraftView draft={view} retryBusy={retry.busy ?? false} retryError={retry.error ?? null} onRetry={() => {}} />,
  );
}

const TITLE_FIELD = /<input[^>]*id="draft-title"/;
const NEW_IMAGE_BUTTON = /<button[^>]*>(<svg[^>]*>.*?<\/svg>)?New image<\/button>/;
const STAGE_BUTTON = /<button[^>]*>(<svg[^>]*>.*?<\/svg>)?Stage for sending<\/button>/;
const STAGE_BUTTON_OFF = /<button[^>]*disabled=""[^>]*>(<svg[^>]*>.*?<\/svg>)?Stage for sending<\/button>/;

describe("DraftView", () => {
  it("shows a running draft's steps live, with the current one named", () => {
    const html = render(draft());

    expect(html).toMatch(/<p[^>]*>Draft · 2026-05-21<\/p>/);
    expect(html).toContain("Now: writing");
    expect(html).toMatch(/data-step="read_articles" data-state="done"/);
    expect(html).toMatch(/data-step="write" data-state="current"/);
    expect(html).toMatch(/data-step="save" data-state="waiting"/);
    expect(html).toContain("Writing the issue…");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Retry");
  });

  it("never shows the draft's own number: the owner sees only staged version numbers (#149)", () => {
    const views = [
      draft({ version: 7 }),
      draft({ version: 7, status: "failed", failedStepLabel: "making the image", error: "No image.", retryable: true }),
      ready({ version: 7 }),
      ready({ version: 7, editable: false, hasNewerDraft: true }),
    ];

    for (const view of views) {
      const html = render(view);

      expect(html).not.toMatch(/\bv7\b/);
      expect(html).not.toMatch(/draft 7\b/i);
    }
    expect(render(views[1])).toContain("Runs this draft again from the start.");
    expect(render(views[2])).toMatch(/<iframe[^>]*title="Email preview"/);
    // A staged version's number is the one the owner does see.
    expect(render(ready({ version: 7, staged: { version: 2, stagedAt: null, serviceName: "GHL", serviceUrl: null } }))).toContain("Staged, v2");
  });

  it("says when the job has not started yet", () => {
    const html = render(draft({ stepLabel: null, startedAt: null, steps: steps([]) }));

    expect(html).toContain("Waiting for the draft job to start");
  });

  it("offers Retry on a draft stuck in running", () => {
    const html = render(draft({ retryable: true }));

    expect(html).toContain("has not moved for 20 minutes");
    expect(html).toContain("Retry");
  });

  it("offers Retry on a draft whose job never started, and says so", () => {
    const html = render(draft({ retryable: true, stepLabel: null, startedAt: null, steps: steps([]) }));

    expect(html).toContain("Its job has not started after 5 minutes");
    expect(html).not.toContain("20 minutes");
    expect(html).toContain("Retry");
  });

  it("shows a ready draft's email in a sandboxed frame", () => {
    const html = render(ready());

    expect(html).toContain("Pretend Lab Ships Planner");
    expect(html).toMatch(/<iframe[^>]*src="\/api\/approval\/drafts\/41\/html"/);
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-popups allow-popups-to-escape-sandbox"/);
    expect(html).not.toContain("Source not read");
    expect(html).not.toContain("Retry");
  });

  it("has no GHL link or template id of its own: the distribution service shows only with a staged version (#149)", () => {
    const html = render(ready());

    expect(html).not.toContain("GHL");
    expect(html).not.toContain("Open in");
    expect(html).not.toContain("New image of");
  });

  it("lists the stories whose source was not read, with a plain note", () => {
    const html = render(
      ready({
        unreadStories: [
          { id: 12, headline: "Sample Robot Folds Laundry", url: "https://robots.example.test/laundry" },
          { id: 13, headline: "Story 13", url: null },
        ],
      }),
    );

    expect(html).toContain("Source not read");
    expect(html).toContain("could not read the article");
    expect(html).toContain("Sample Robot Folds Laundry");
    expect(html).toContain('href="https://robots.example.test/laundry"');
    expect(html).toContain("Story 13");
  });

  it("shows a failed draft's step, its error in plain words, and Retry", () => {
    const html = render(
      draft({
        status: "failed",
        stepLabel: null,
        failedStep: "image",
        failedStepLabel: "making the image",
        error: "Vertex returned no image.",
        steps: steps(["done", "done", "done", "done", "failed"]),
        retryable: true,
      }),
    );

    expect(html).toContain("Failed at making the image");
    expect(html).toContain("Vertex returned no image.");
    expect(html).toMatch(/data-step="image" data-state="failed"/);
    expect(html).toMatch(/<button[^>]*>Retry<\/button>/);
  });

  describe("the title (#149)", () => {
    it("shows the current draft's title in a field the owner can change, not as a heading", () => {
      const html = render(ready());

      expect(html).toMatch(TITLE_FIELD);
      expect(html).toMatch(/<input[^>]*value="Pretend Lab Ships Planner"/);
      expect(html).not.toContain("<h2");
      // Nothing to save until the owner types.
      expect(html).not.toMatch(/<button[^>]*>Save<\/button>/);
    });

    it("shows the title as a plain heading on a ready draft that is not the current draft", () => {
      for (const view of [ready({ editable: false, hasNewerDraft: true }), ready({ editable: false, issuePublished: true })]) {
        const html = render(view);

        expect(html).toMatch(/<h2[^>]*>Pretend Lab Ships Planner<\/h2>/);
        expect(html).not.toMatch(TITLE_FIELD);
      }
    });

    it("shows a plain heading on a running or failed draft, even with a written title", () => {
      const failed = render(draft({ status: "failed", subject: "Pretend Lab Ships Planner", retryable: true }));

      expect(failed).toMatch(/<h2[^>]*>Pretend Lab Ships Planner<\/h2>/);
      expect(failed).not.toMatch(TITLE_FIELD);
      expect(render(draft())).toMatch(/<h2[^>]*>Writing the issue…<\/h2>/);
      expect(render(draft())).not.toMatch(TITLE_FIELD);
    });

    it("shows no field for an editable draft that has no title", () => {
      const html = render(ready({ subject: null }));

      expect(html).toMatch(/<h2[^>]*>No subject yet<\/h2>/);
      expect(html).not.toMatch(TITLE_FIELD);
    });
  });

  describe("the time of the last change (#149)", () => {
    it("says when the owner last changed the title or the image", () => {
      const html = render(ready({ editedAt: "2026-05-21T14:30:00.000Z" }));

      expect(html).toContain("· changed May 21, 10:30 AM EDT");
    });

    it("says nothing for a draft as the job made it", () => {
      const html = render(ready());

      expect(html).toContain("Committed May 21, 10:00 AM EDT");
      expect(html).toContain("· finished May 21, 10:01 AM EDT");
      expect(html).not.toContain("changed");
    });

    it("still shows the email preview after a change", () => {
      expect(render(ready({ editedAt: "2026-05-21T14:30:00.000Z" }))).toMatch(/<iframe[^>]*src="\/api\/approval\/drafts\/41\/html"/);
    });
  });

  describe("New image (#116, #149)", () => {
    it("offers New image on the current draft", () => {
      expect(render(ready())).toMatch(NEW_IMAGE_BUTTON);
    });

    it("does not offer it on a ready draft that is not editable: the issue is published, or a newer draft exists", () => {
      expect(render(ready({ editable: false, issuePublished: true }))).not.toMatch(NEW_IMAGE_BUTTON);
      expect(render(ready({ editable: false, hasNewerDraft: true }))).not.toMatch(NEW_IMAGE_BUTTON);
    });

    it("does not offer it on a running or failed draft", () => {
      expect(render(draft())).not.toMatch(NEW_IMAGE_BUTTON);
      expect(render(draft({ status: "failed", retryable: true }))).not.toMatch(NEW_IMAGE_BUTTON);
    });
  });

  describe("Stage for sending (#149)", () => {
    it("offers Stage for sending on the current draft, and says what it does", () => {
      const html = render(ready());

      expect(html).toMatch(STAGE_BUTTON);
      expect(html).not.toMatch(STAGE_BUTTON_OFF);
      expect(html).toContain("Copies this draft to the distribution service as the next staged version.");
      expect(html).not.toContain("Staged, v");
    });

    it("shows the button on every draft, turned off with the reason when the draft cannot be staged", () => {
      const cases: Array<[DraftBoardView, string]> = [
        [draft(), "The draft is not ready yet."],
        [draft({ status: "failed", retryable: true }), "This draft failed. Retry it first."],
        [ready({ editable: false, issuePublished: true }), "This issue is published. Nothing more can be staged."],
        [ready({ editable: false, hasNewerDraft: true }), "A newer draft exists. Only the newest draft can be staged."],
      ];

      for (const [view, reason] of cases) {
        const html = render(view);

        expect(html).toMatch(STAGE_BUTTON_OFF);
        expect(html).toContain(reason);
      }
    });

    it("shows the issue's newest staged version, with a link into the distribution service", () => {
      const html = render(
        ready({ staged: { version: 3, stagedAt: "2026-05-21T14:20:00.000Z", serviceName: "GHL", serviceUrl: "https://preview.example.test/v3" } }),
      );

      expect(html).toContain("Staged, v3");
      expect(html).toContain("May 21, 10:20 AM EDT");
      expect(html).toMatch(/<a[^>]*href="https:\/\/preview\.example\.test\/v3"[^>]*>Open in GHL/);
    });

    it("shows the staged version on a draft that can no longer be staged", () => {
      const html = render(
        ready({
          editable: false,
          issuePublished: true,
          staged: { version: 1, stagedAt: "2026-05-21T14:20:00.000Z", serviceName: "GHL", serviceUrl: null },
        }),
      );

      expect(html).toContain("Staged, v1");
      expect(html).toContain("Find it in GHL by its name.");
      expect(html).toMatch(STAGE_BUTTON_OFF);
    });
  });

  it("shows Retry as busy, and a retry error", () => {
    const failed = draft({ status: "failed", failedStepLabel: "starting the draft job", error: "x", retryable: true });

    expect(render(failed, { busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Retrying…<\/button>/);
    expect(render(failed, { error: "Draft 41 is running now." })).toContain("Draft 41 is running now.");
  });
});
