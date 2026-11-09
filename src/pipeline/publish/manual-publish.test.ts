import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { manualPublish, previewManualPublish, type ManualPublishStore } from "@/src/pipeline/publish/manual-publish";
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";
import type { DraftIssue } from "@/src/pipeline/publish/publish-store";

const NOW = new Date("2026-11-09T18:00:00.000Z");
const DRAFT_HTML = renderIssueEmail(PLACEHOLDER_ISSUE);

function fakeStore(draft: DraftIssue | null) {
  const publish = vi.fn(async () => "published" as const);
  const store: ManualPublishStore = { findDraft: async () => draft, publish };
  return { store, publish };
}

const draft = (overrides: Partial<DraftIssue> = {}): DraftIssue => ({
  id: 268,
  title: "Draft title",
  issueDate: new Date("2026-11-03T00:00:00.000Z"),
  publishedAt: null,
  html: DRAFT_HTML,
  ...overrides,
});

describe("previewManualPublish", () => {
  it("shows what a draft would publish", async () => {
    const { store } = fakeStore(draft());

    await expect(previewManualPublish(268, store)).resolves.toEqual({
      issueId: 268,
      status: "ready",
      title: "Placeholder Title For Tests",
      date: "2026-11-03",
      storyCount: 6,
      problems: [],
    });
  });

  it("reports a missing issue, a published issue, missing email HTML, and HTML for another issue", async () => {
    expect((await previewManualPublish(268, fakeStore(null).store)).status).toBe("not_found");
    expect(
      (await previewManualPublish(268, fakeStore(draft({ publishedAt: new Date() })).store)).status,
    ).toBe("already_published");
    expect((await previewManualPublish(268, fakeStore(draft({ html: null })).store)).status).toBe("no_email");
    expect((await previewManualPublish(999, fakeStore(draft({ id: 999 })).store)).status).toBe("wrong_issue");
  });
});

describe("manualPublish", () => {
  it("publishes a ready draft now, from its stored email HTML", async () => {
    const { store, publish } = fakeStore(draft());

    const result = await manualPublish(268, NOW, store);

    expect(result.outcome).toBe("published");
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        issueId: 268,
        publishedAt: NOW,
        storyIds: [11023, 11007, 10996, 11009, 11010, 10998],
        content: expect.objectContaining({ issue_id: 268, title: "Placeholder Title For Tests" }),
        event: expect.objectContaining({ mode: "manual", outcome: "published", gmailMessageId: null, issueId: 268 }),
      }),
    );
  });

  it("records which native draft it published", async () => {
    const html = DRAFT_HTML.replace('data-issue-id="268"', 'data-issue-id="268" data-draft-id="41"');
    const { store, publish } = fakeStore(draft({ html }));

    await manualPublish(268, NOW, store);

    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ draftId: 41 }) }));
  });

  it("publishes a draft with parse problems, because a person confirmed it", async () => {
    const html = renderIssueEmail({ ...PLACEHOLDER_ISSUE, summary: undefined });
    const { store, publish } = fakeStore(draft({ html }));

    const result = await manualPublish(268, NOW, store);

    expect(result.preview.problems).toEqual(["No overview summary found."]);
    expect(result.outcome).toBe("published");
    expect(publish).toHaveBeenCalled();
  });

  it("does not publish anything that is not ready", async () => {
    const { store, publish } = fakeStore(draft({ publishedAt: new Date() }));

    expect((await manualPublish(268, NOW, store)).outcome).toBe("already_published");
    expect(publish).not.toHaveBeenCalled();
  });
});
