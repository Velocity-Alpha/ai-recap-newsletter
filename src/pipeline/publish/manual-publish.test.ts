import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { manualPublish, previewManualPublish, type ManualPublishStore } from "@/src/pipeline/publish/manual-publish";
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";
import type { DraftIssue } from "@/src/pipeline/publish/publish-store";

const NOW = new Date("2026-11-09T18:00:00.000Z");
const DRAFT_HTML = renderIssueEmail(PLACEHOLDER_ISSUE);

/** `stagedHtml` is the email HTML of the issue's newest staged version; null when nothing is staged. */
function fakeStore(draft: DraftIssue | null, stagedHtml: string | null = null) {
  const publish = vi.fn<ManualPublishStore["publish"]>(async () => "published" as const);
  const newestStagedHtml = vi.fn<ManualPublishStore["newestStagedHtml"]>(async () => stagedHtml);
  const store: ManualPublishStore = { findDraft: async () => draft, newestStagedHtml, publish };
  return { store, publish, newestStagedHtml };
}

/** The email of a staged version: it names its draft and its staged version, and can differ from the issue's HTML. */
function stagedEmail(overrides: Partial<typeof PLACEHOLDER_ISSUE> = {}, ids = 'data-draft-id="41" data-version-id="93"'): string {
  return renderIssueEmail({ ...PLACEHOLDER_ISSUE, ...overrides }).replace('data-issue-id="268"', `data-issue-id="268" ${ids}`);
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

  it("shows the newest staged version, which is what the owner sends, not the issue's HTML", async () => {
    const { store, newestStagedHtml } = fakeStore(draft(), stagedEmail({ title: "Staged Title For Tests", quickHits: [] }));

    await expect(previewManualPublish(268, store)).resolves.toEqual({
      issueId: 268,
      status: "ready",
      title: "Staged Title For Tests",
      date: "2026-11-03",
      storyCount: 5,
      problems: [],
    });
    expect(newestStagedHtml).toHaveBeenCalledWith(268);
  });

  it("is ready from the staged version alone, when the issue has no HTML", async () => {
    const { store } = fakeStore(draft({ html: null }), stagedEmail());

    expect((await previewManualPublish(268, store)).status).toBe("ready");
  });

  it("reports a staged version whose email is for another issue", async () => {
    const { store } = fakeStore(draft({ id: 999 }), stagedEmail());

    expect((await previewManualPublish(999, store)).status).toBe("wrong_issue");
  });

  it("does not look for a staged version when the issue is missing", async () => {
    const { store, newestStagedHtml } = fakeStore(null, stagedEmail());

    expect((await previewManualPublish(268, store)).status).toBe("not_found");
    expect(newestStagedHtml).not.toHaveBeenCalled();
  });
});

describe("manualPublish", () => {
  it("publishes the newest staged version's email, so the publish event carries its version id", async () => {
    const { store, publish, newestStagedHtml } = fakeStore(draft(), stagedEmail({ title: "Staged Title For Tests", quickHits: [] }));

    const result = await manualPublish(268, NOW, store);

    expect(result.outcome).toBe("published");
    expect(result.preview).toMatchObject({ status: "ready", title: "Staged Title For Tests", storyCount: 5 });
    expect(newestStagedHtml).toHaveBeenCalledWith(268);
    expect(publish).toHaveBeenCalledTimes(1);
    expect(publish).toHaveBeenCalledWith({
      issueId: 268,
      publishedAt: NOW,
      storyIds: [11023, 11007, 10996, 11009, 11010],
      content: expect.objectContaining({ issue_id: 268, title: "Staged Title For Tests" }),
      event: {
        mode: "manual",
        outcome: "published",
        gmailMessageId: null,
        receivedAt: null,
        issueId: 268,
        subject: null,
        title: "Staged Title For Tests",
        storyIds: [11023, 11007, 10996, 11009, 11010],
        contentJson: expect.objectContaining({ issue_id: 268, title: "Staged Title For Tests" }),
        problems: [],
        draftId: 41,
        versionId: 93,
      },
    });
  });

  it("falls back to the issue's HTML when nothing is staged, and the event names no staged version", async () => {
    const { store, publish, newestStagedHtml } = fakeStore(draft(), null);

    const result = await manualPublish(268, NOW, store);

    expect(result.outcome).toBe("published");
    expect(newestStagedHtml).toHaveBeenCalledWith(268);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        storyIds: [11023, 11007, 10996, 11009, 11010, 10998],
        content: expect.objectContaining({ title: "Placeholder Title For Tests" }),
        event: expect.objectContaining({ title: "Placeholder Title For Tests", draftId: null, versionId: null }),
      }),
    );
  });

  it("publishes from the staged version alone, when the issue has no HTML", async () => {
    const { store, publish } = fakeStore(draft({ html: null }), stagedEmail());

    expect((await manualPublish(268, NOW, store)).outcome).toBe("published");
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({ event: expect.objectContaining({ draftId: 41, versionId: 93 }) }));
  });

  it("publishes nothing when neither a staged version nor the issue has email HTML", async () => {
    const { store, publish } = fakeStore(draft({ html: null }), null);

    expect((await manualPublish(268, NOW, store)).outcome).toBe("no_email");
    expect(publish).not.toHaveBeenCalled();
  });

  it("publishes nothing when the staged version's email is for another issue, even if the issue's own HTML is right", async () => {
    const { store, publish } = fakeStore(draft(), stagedEmail().replace('data-issue-id="268"', 'data-issue-id="999"'));

    expect((await manualPublish(268, NOW, store)).outcome).toBe("wrong_issue");
    expect(publish).not.toHaveBeenCalled();
  });

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
