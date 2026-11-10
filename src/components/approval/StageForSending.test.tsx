import { readFileSync } from "node:fs";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import StageForSending, { stageDisabledReason, StagePanel, type StagePanelProps } from "@/src/components/approval/StageForSending";
import type { DraftBoardView, StagedSummary } from "@/src/pipeline/draft/draft-board";

const noop = () => {};
const STAGED: StagedSummary = {
  version: 3,
  stagedAt: "2026-05-21T14:20:00.000Z",
  serviceName: "Pretend Mail",
  serviceUrl: "https://preview.example.test/v3",
};

function render(props: Partial<StagePanelProps> = {}) {
  return renderToStaticMarkup(
    <StagePanel
      staged={null}
      recorded={false}
      disabledReason={null}
      busy={false}
      confirmVersion={null}
      error={null}
      onStage={noop}
      onConfirm={noop}
      onCancel={noop}
      {...props}
    />,
  );
}

const ICON = "(<svg[^>]*>.*?</svg>)?";
const STAGE = new RegExp(`<button[^>]*>${ICON}Stage for sending</button>`);
const STAGE_OFF = new RegExp(`<button[^>]*disabled=""[^>]*>${ICON}Stage for sending</button>`);
const STAGING_OFF = new RegExp(`<button[^>]*disabled=""[^>]*>${ICON}Staging…</button>`);
const AGAIN = /<button[^>]*>Stage it again<\/button>/;
const CANCEL = /<button[^>]*>Cancel<\/button>/;
const WHAT_IT_DOES = "Copies this draft to the distribution service as the next staged version. You send it from there.";

type Stageable = Pick<DraftBoardView, "status" | "issuePublished" | "hasNewerDraft">;
const stageable = (data: Partial<Stageable> = {}): Stageable => ({ status: "ready", issuePublished: false, hasNewerDraft: false, ...data });

describe("stageDisabledReason", () => {
  it("lets a ready draft be staged: the newest draft of an issue that is not published", () => {
    expect(stageDisabledReason(stageable())).toBeNull();
  });

  it("says a running draft is not ready yet", () => {
    expect(stageDisabledReason(stageable({ status: "running" }))).toBe("The draft is not ready yet.");
  });

  it("says a failed draft must be retried first", () => {
    expect(stageDisabledReason(stageable({ status: "failed" }))).toBe("This draft failed. Retry it first.");
  });

  it("says nothing more can be staged once the issue is published", () => {
    expect(stageDisabledReason(stageable({ issuePublished: true }))).toBe("This issue is published. Nothing more can be staged.");
  });

  it("says only the newest draft can be staged when a newer draft exists", () => {
    expect(stageDisabledReason(stageable({ hasNewerDraft: true }))).toBe("A newer draft exists. Only the newest draft can be staged.");
  });

  it("gives the published issue as the reason before any other", () => {
    expect(stageDisabledReason({ status: "failed", issuePublished: true, hasNewerDraft: true })).toBe(
      "This issue is published. Nothing more can be staged.",
    );
  });

  it("waits for a typed title to be saved or cancelled: staging would leave it out", () => {
    expect(stageDisabledReason(stageable(), { titleDirty: true })).toBe("Save or cancel the title change first.");
    expect(stageDisabledReason(stageable(), { titleDirty: false })).toBeNull();
  });

  it("gives the draft's own reason before the unsaved title", () => {
    expect(stageDisabledReason(stageable({ issuePublished: true }), { titleDirty: true })).toBe("This issue is published. Nothing more can be staged.");
    expect(stageDisabledReason(stageable({ hasNewerDraft: true }), { titleDirty: true })).toBe(
      "A newer draft exists. Only the newest draft can be staged.",
    );
  });

  it("gives the newer draft as the reason for an old running or failed draft", () => {
    const reason = "A newer draft exists. Only the newest draft can be staged.";

    expect(stageDisabledReason(stageable({ status: "running", hasNewerDraft: true }))).toBe(reason);
    expect(stageDisabledReason(stageable({ status: "failed", hasNewerDraft: true }))).toBe(reason);
  });
});

describe("StagePanel", () => {
  it("offers Stage for sending, and says what it does", () => {
    const html = render();

    expect(html).toMatch(STAGE);
    expect(html).not.toMatch(STAGE_OFF);
    expect(html).toContain(WHAT_IT_DOES);
    expect(html).not.toContain("Staged, v");
    expect(html).not.toContain('role="alert"');
  });

  it("turns the button off and gives the reason when the draft cannot be staged", () => {
    const html = render({ disabledReason: "A newer draft exists. Only the newest draft can be staged." });

    expect(html).toMatch(STAGE_OFF);
    expect(html).toContain("A newer draft exists. Only the newest draft can be staged.");
    expect(html).not.toContain(WHAT_IT_DOES);
  });

  it("shows Staging… with the button off while it stages", () => {
    const html = render({ busy: true });

    expect(html).toMatch(STAGING_OFF);
    expect(html).not.toMatch(STAGE);
  });

  describe("a draft that has not changed since the newest staged version", () => {
    it("asks on the page before it stages again, with Stage it again and Cancel", () => {
      const html = render({ staged: { ...STAGED, version: 2 }, confirmVersion: 2 });

      expect(html).toContain("v2 is already staged, and the draft has not changed since. Stage it again?");
      expect(html).toMatch(AGAIN);
      expect(html).toMatch(CANCEL);
      expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Stage it again<\/button>/);
      expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
    });

    it("turns the main button off while it asks, so only the answer can stage", () => {
      expect(render({ confirmVersion: 2 })).toMatch(STAGE_OFF);
    });

    it("shows the second staging as busy, with both answers off", () => {
      const html = render({ confirmVersion: 2, busy: true });

      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Staging…<\/button>/);
      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
      expect(html).not.toMatch(AGAIN);
    });

    it("turns the yes off too while the draft cannot be staged, and leaves Cancel on", () => {
      const html = render({ confirmVersion: 2, disabledReason: "Save or cancel the title change first." });

      expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Stage it again<\/button>/);
      expect(html).not.toMatch(/<button[^>]*disabled=""[^>]*>Cancel<\/button>/);
      expect(html).toContain("Save or cancel the title change first.");
    });

    it("does not ask when the draft has changed, or was never staged", () => {
      const html = render({ staged: STAGED });

      expect(html).not.toContain("already staged");
      expect(html).not.toMatch(AGAIN);
      expect(html).not.toMatch(CANCEL);
    });

    it("never uses the browser's own confirm box", () => {
      const source = readFileSync(new URL("./StageForSending.tsx", import.meta.url), "utf8");

      expect(source).not.toMatch(/\bconfirm\s*\(/);
      expect(source).not.toMatch(/\b(alert|prompt)\s*\(/);
    });
  });

  describe("the newest staged version", () => {
    it("shows its version, its time, and a link that opens it in the distribution service", () => {
      const html = render({ staged: STAGED });

      expect(html).toContain("Staged, v3");
      expect(html).toContain('data-staged-version="3"');
      expect(html).toContain("May 21, 10:20 AM EDT");
      expect(html).toMatch(/<a[^>]*href="https:\/\/preview\.example\.test\/v3"[^>]*>Open in Pretend Mail/);
      expect(html).toMatch(/<a[^>]*target="_blank"[^>]*rel="noreferrer"/);
      expect(html).not.toContain("Find it in");
      expect(html).not.toContain("Not sent outside production");
    });

    it("names the distribution service it was given, not a fixed one", () => {
      const html = render({ staged: { ...STAGED, serviceName: "Pretend Mailer" } });

      expect(html).toContain("Open in Pretend Mailer");
      expect(html).not.toContain("GHL");
    });

    it("says where to find it when the service gave no link", () => {
      const html = render({ staged: { ...STAGED, serviceUrl: null } });

      expect(html).toContain("Staged, v3");
      expect(html).toContain("Find it in Pretend Mail by its name.");
      expect(html).not.toContain("<a ");
      expect(html).not.toContain("Open in");
    });

    it("says nothing reached the service when it was staged outside production", () => {
      const html = render({ staged: { ...STAGED, serviceUrl: null }, recorded: true });

      expect(html).toContain("Staged, v3");
      expect(html).toContain("Not sent outside production: nothing reached Pretend Mail.");
      expect(html).not.toContain("Find it in");
      expect(html).not.toContain("<a ");
    });

    it("leaves out the time when the staged version has none", () => {
      const html = render({ staged: { ...STAGED, stagedAt: null } });

      expect(html).toContain("Staged, v3");
      expect(html).not.toContain("May 21");
    });

    it("still offers Stage for sending, to stage the next version", () => {
      const html = render({ staged: STAGED });

      expect(html).toMatch(STAGE);
      expect(html).not.toMatch(STAGE_OFF);
    });
  });

  it("shows an error in plain words", () => {
    const html = render({ error: "Staging failed: the distribution service answered HTTP 401." });

    expect(html).toMatch(/<p[^>]*role="alert"[^>]*>Staging failed: the distribution service answered HTTP 401.<\/p>/);
    expect(html).toMatch(STAGE);
  });
});

describe("StageForSending", () => {
  function draft(data: Partial<DraftBoardView> = {}): DraftBoardView {
    return {
      id: 41,
      issueId: 3,
      issueDate: "2026-05-21",
      version: 2,
      status: "ready",
      subject: "Pretend Lab Ships Planner",
      stepLabel: null,
      failedStep: null,
      failedStepLabel: null,
      error: null,
      steps: [],
      hasHtml: true,
      unreadStories: [],
      retryable: false,
      editable: true,
      issuePublished: false,
      hasNewerDraft: false,
      featuredImageUrl: null,
      scenePrompt: null,
      editedAt: null,
      staged: null,
      createdAt: "2026-05-21T14:00:00.000Z",
      startedAt: "2026-05-21T14:00:01.000Z",
      finishedAt: "2026-05-21T14:01:10.000Z",
      ...data,
    };
  }

  it("starts with the button on for the current draft, and no question or error", () => {
    const html = renderToStaticMarkup(<StageForSending draft={draft()} />);

    expect(html).toMatch(STAGE);
    expect(html).not.toMatch(STAGE_OFF);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain("Staged, v");
  });

  it("shows the draft's staged version, as sent to the service", () => {
    const html = renderToStaticMarkup(<StageForSending draft={draft({ staged: STAGED })} />);

    expect(html).toContain("Staged, v3");
    expect(html).toContain("Open in Pretend Mail");
    expect(html).not.toContain("Not sent outside production");
  });

  it("turns the button off while the title field holds a title that is not saved", () => {
    const html = renderToStaticMarkup(<StageForSending draft={draft()} titleDirty />);

    expect(html).toMatch(STAGE_OFF);
    expect(html).toContain("Save or cancel the title change first.");
    expect(html).not.toContain(WHAT_IT_DOES);
  });

  it("turns the button off with the draft's reason", () => {
    const html = renderToStaticMarkup(<StageForSending draft={draft({ editable: false, issuePublished: true })} />);

    expect(html).toMatch(STAGE_OFF);
    expect(html).toContain("This issue is published. Nothing more can be staged.");
  });
});
