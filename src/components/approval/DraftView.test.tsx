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
  ["ghl", "creating the GHL template"],
  ["save", "saving the draft"],
];

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
    ghlTemplateId: null,
    ghlPreviewUrl: null,
    unreadStories: [],
    retryable: false,
    newImageAllowed: false,
    featuredImageUrl: null,
    scenePrompt: null,
    sourceVersion: null,
    createdAt: "2026-05-21T14:00:00.000Z",
    startedAt: "2026-05-21T14:00:01.000Z",
    finishedAt: null,
    ...data,
  };
}

function render(view: DraftBoardView, retry: { busy?: boolean; error?: string | null } = {}) {
  return renderToStaticMarkup(
    <DraftView draft={view} retryBusy={retry.busy ?? false} retryError={retry.error ?? null} onRetry={() => {}} />,
  );
}

describe("DraftView", () => {
  it("shows a running draft's steps live, with the current one named", () => {
    const html = render(draft());

    expect(html).toContain("Draft v2");
    expect(html).toContain("Now: writing");
    expect(html).toMatch(/data-step="read_articles" data-state="done"/);
    expect(html).toMatch(/data-step="write" data-state="current"/);
    expect(html).toMatch(/data-step="ghl" data-state="waiting"/);
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Retry");
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

  it("shows a ready draft's email in a sandboxed frame, with its GHL link", () => {
    const html = render(
      draft({
        status: "ready",
        subject: "Pretend Lab Ships Planner",
        stepLabel: null,
        steps: steps(Array(8).fill("done")),
        hasHtml: true,
        ghlTemplateId: "tpl-1",
        ghlPreviewUrl: "https://preview.example.test/tpl-1",
        finishedAt: "2026-05-21T14:01:10.000Z",
      }),
    );

    expect(html).toContain("Pretend Lab Ships Planner");
    expect(html).toMatch(/<iframe[^>]*src="\/api\/approval\/drafts\/41\/html"/);
    expect(html).toMatch(/<iframe[^>]*sandbox="allow-popups allow-popups-to-escape-sandbox"/);
    expect(html).toContain('href="https://preview.example.test/tpl-1"');
    expect(html).toContain("Open in GHL");
    expect(html).not.toContain("Source not read");
    expect(html).not.toContain("Retry");
  });

  it("names the GHL template when GHL gave no link", () => {
    const html = render(draft({ status: "ready", stepLabel: null, hasHtml: true, ghlTemplateId: "tpl-9", steps: steps(Array(8).fill("done")) }));

    expect(html).toContain("GHL template tpl-9");
    expect(html).not.toContain("Open in GHL");
  });

  it("lists the stories whose source was not read, with a plain note", () => {
    const html = render(
      draft({
        status: "ready",
        stepLabel: null,
        hasHtml: true,
        steps: steps(Array(8).fill("done")),
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

  describe("New image (#116)", () => {
    const ready = (data: Partial<DraftBoardView> = {}) =>
      draft({ status: "ready", stepLabel: null, hasHtml: true, steps: steps(Array(8).fill("done")), ghlTemplateId: "tpl-1", ...data });
    const NEW_IMAGE_BUTTON = /<button[^>]*>(<svg[^>]*>.*?<\/svg>)?New image<\/button>/;

    it("offers New image on a ready draft whose issue is not published", () => {
      expect(render(ready({ newImageAllowed: true }))).toMatch(NEW_IMAGE_BUTTON);
    });

    it("does not offer it once the issue is published", () => {
      expect(render(ready({ newImageAllowed: false }))).not.toMatch(NEW_IMAGE_BUTTON);
    });

    it("does not offer it on a running or failed draft", () => {
      expect(render(draft({ newImageAllowed: true }))).not.toMatch(NEW_IMAGE_BUTTON);
      expect(render(draft({ status: "failed", retryable: true, newImageAllowed: true }))).not.toMatch(NEW_IMAGE_BUTTON);
    });

    it("says which draft a new-image draft came from", () => {
      expect(render(ready({ version: 3, sourceVersion: 2 }))).toContain("New image of v2");
      expect(render(ready())).not.toContain("New image of");
    });
  });

  it("shows Retry as busy, and a retry error", () => {
    const failed = draft({ status: "failed", failedStepLabel: "starting the draft job", error: "x", retryable: true });

    expect(render(failed, { busy: true })).toMatch(/<button[^>]*disabled=""[^>]*>Retrying…<\/button>/);
    expect(render(failed, { error: "Draft 41 is running now." })).toContain("Draft 41 is running now.");
  });
});
