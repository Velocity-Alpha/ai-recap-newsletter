import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});

import {
  changeDraftTitle,
  cleanTitle,
  draftEditErrorResponse,
  DraftTitleError,
  MAX_TITLE_CHARS,
} from "@/src/pipeline/draft/draft-edit";
import { createDraft, DraftEditError, IssuePublishedError, titleTakenMessage } from "@/src/pipeline/draft/draft-store";
import { SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";

const DATE = "2027-01-04";
const NOW = new Date("2027-01-04T15:00:00.000Z");
const IMAGE = "https://assets.example.test/newsletter-dev/2027-01-04-old.jpg";
const NEW_TITLE = "A Sample Robot Learns To Fold";

async function readyDraft() {
  const outline = (await fakeDb.client.approvalOutline.create({
    data: { issueDate: new Date(`${DATE}T00:00:00.000Z`), payload: SAMPLE_OUTLINE, payloadHash: "h" },
  })) as { id: bigint };
  const created = await createDraft(outline.id);
  await fakeDb.client.issueDraft.update({
    where: { id: BigInt(created.draftId) },
    data: { status: "ready", content: SAMPLE_CONTENT, html: "<html>v1</html>", featuredImageUrl: IMAGE, scenePrompt: "A pretend robot." },
  });
  return created;
}

function draftRow(id: number) {
  return fakeDb.state.drafts.rows.find((row) => Number(row.id) === id)!;
}

function issueRow(id: number) {
  return fakeDb.state.issues.rows.find((row) => Number(row.id) === id)!;
}

beforeEach(() => {
  fakeDb.reset();
});

describe("cleanTitle", () => {
  it("keeps a plain title as it is", () => {
    expect(cleanTitle(NEW_TITLE)).toBe(NEW_TITLE);
  });

  it("makes one line: runs of white space, line breaks and tabs too, become one space, and the ends are trimmed", () => {
    expect(cleanTitle("  A  Sample\tRobot \r\n Learns\n\nTo   Fold \n")).toBe("A Sample Robot Learns To Fold");
  });

  it.each([
    ["nothing", undefined],
    ["null", null],
    ["a number", 42],
    ["a list", ["A title"]],
    ["an object", { title: "A title" }],
  ])("refuses %s, since the title must be text", (_name, value) => {
    const attempt = () => cleanTitle(value);

    expect(attempt).toThrow(DraftTitleError);
    expect(attempt).toThrow("Send the new title.");
  });

  it.each([
    ["an empty title", ""],
    ["a title of only white space", " \n\t  "],
  ])("refuses %s", (_name, value) => {
    const attempt = () => cleanTitle(value);

    expect(attempt).toThrow(DraftTitleError);
    expect(attempt).toThrow("The title is empty. Write a title first.");
  });

  it(`allows a title of ${MAX_TITLE_CHARS} characters, and refuses one more, counting after the white space is cleaned`, () => {
    const longest = "x".repeat(MAX_TITLE_CHARS);

    expect(cleanTitle(longest)).toBe(longest);
    expect(cleanTitle(`   ${longest}   `)).toBe(longest);
    const attempt = () => cleanTitle(`${longest}x`);
    expect(attempt).toThrow(DraftTitleError);
    expect(attempt).toThrow(`The title is ${MAX_TITLE_CHARS + 1} characters. Keep it to ${MAX_TITLE_CHARS} or fewer.`);
  });

  it("names its error", () => {
    expect(new DraftTitleError("x").name).toBe("DraftTitleError");
  });
});

describe("changeDraftTitle", () => {
  it("puts the cleaned title into the current draft and the issue, and builds the draft's email HTML again", async () => {
    const draft = await readyDraft();

    const changed = await changeDraftTitle(draft.draftId, { title: "  A Sample Robot\n Learns  To Fold " }, { now: () => NOW });

    const content = { ...SAMPLE_CONTENT, title: NEW_TITLE };
    expect(changed).toEqual({
      draftId: draft.draftId,
      issueId: draft.issueId,
      version: 1,
      issueDate: DATE,
      content,
      featuredImageUrl: IMAGE,
      scenePrompt: "A pretend robot.",
    });
    const row = draftRow(draft.draftId);
    expect(row).toMatchObject({ version: 1, status: "ready", content, featuredImageUrl: IMAGE, editedAt: NOW });
    expect(row.html).toContain(NEW_TITLE);
    expect(row.html).not.toContain(SAMPLE_CONTENT.title);
    expect(issueRow(draft.issueId)).toMatchObject({ title: NEW_TITLE, html: row.html, featureImageUrl: IMAGE });
    expect(fakeDb.state.drafts.rows).toHaveLength(1);
    expect(fakeDb.state.stagedVersions.rows).toHaveLength(0);
  });

  it.each([
    ["no body", null, "Send the new title."],
    ["a body that is not an object", "A title", "Send the new title."],
    ["no title", {}, "Send the new title."],
    ["a title that is not text", { title: 42 }, "Send the new title."],
    ["an empty title", { title: "   " }, "The title is empty. Write a title first."],
    ["a title that is too long", { title: "x".repeat(MAX_TITLE_CHARS + 1) }, `Keep it to ${MAX_TITLE_CHARS} or fewer.`],
  ])("refuses %s, and leaves the draft and the issue as they were", async (_name, body, message) => {
    const draft = await readyDraft();
    const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });
    fakeDb.state.locks.length = 0;

    const error = await changeDraftTitle(draft.draftId, body, { now: () => NOW }).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(DraftTitleError);
    expect((error as Error).message).toContain(message);
    expect(draftRow(draft.draftId)).toEqual(before.draft);
    expect(issueRow(draft.issueId)).toEqual(before.issue);
    expect(fakeDb.state.locks).toEqual([]);
  });

  it("checks the title before it looks for the draft", async () => {
    await expect(changeDraftTitle(999, { title: "" })).rejects.toBeInstanceOf(DraftTitleError);
    await expect(changeDraftTitle(999, { title: NEW_TITLE })).rejects.toMatchObject({ name: "DraftEditError", reason: "missing" });
  });

  it("refuses an older draft once a newer one exists, and a draft that is not ready", async () => {
    const v1 = await readyDraft();
    const v2 = await createDraft(fakeDb.state.outlines.rows[0].id);
    const before = structuredClone(fakeDb.state.drafts.rows);

    await expect(changeDraftTitle(v1.draftId, { title: NEW_TITLE }, { now: () => NOW })).rejects.toMatchObject({ reason: "not_current" });
    await expect(changeDraftTitle(v2.draftId, { title: NEW_TITLE }, { now: () => NOW })).rejects.toMatchObject({ reason: "not_ready" });
    expect(fakeDb.state.drafts.rows).toEqual(before);
  });

  it("refuses once the issue is published, and never changes it", async () => {
    const draft = await readyDraft();
    await fakeDb.client.issue.update({ where: { id: BigInt(draft.issueId) }, data: { publishedAt: NOW, title: "Sent issue" } });
    const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });

    await expect(changeDraftTitle(draft.draftId, { title: NEW_TITLE }, { now: () => NOW })).rejects.toBeInstanceOf(IssuePublishedError);

    expect(draftRow(draft.draftId)).toEqual(before.draft);
    expect(issueRow(draft.issueId)).toEqual(before.issue);
  });

  it("says the cleaned title is taken when another issue already has it, and keeps the old title", async () => {
    const draft = await readyDraft();
    const before = structuredClone({ draft: draftRow(draft.draftId), issue: issueRow(draft.issueId) });
    fakeDb.state.issueUpdateError = Object.assign(new Error("Unique constraint failed on the fields: (`slug`)"), { code: "P2002" });

    const error = await changeDraftTitle(draft.draftId, { title: `  ${NEW_TITLE}  ` }, { now: () => NOW }).catch((reason: unknown) => reason);

    expect(error).toMatchObject({ name: "DraftEditError", reason: "title_taken", message: titleTakenMessage(NEW_TITLE, "Use a different title.") });
    expect(draftEditErrorResponse(error)).toEqual({
      status: 409,
      error: `Another issue already uses the title "${NEW_TITLE}", and titles must be unique. Use a different title.`,
    });
    expect(draftRow(draft.draftId)).toEqual(before.draft);
    expect(issueRow(draft.issueId)).toEqual(before.issue);
  });
});

describe("draftEditErrorResponse", () => {
  it("answers 400 for a title that cannot be used", () => {
    expect(draftEditErrorResponse(new DraftTitleError("The title is empty. Write a title first."))).toEqual({
      status: 400,
      error: "The title is empty. Write a title first.",
    });
  });

  it("answers 404 for a draft that does not exist", () => {
    expect(draftEditErrorResponse(new DraftEditError("Draft 9 does not exist.", "missing"))).toEqual({ status: 404, error: "Draft 9 does not exist." });
  });

  it.each(["not_ready", "not_current", "title_taken"] as const)("answers 409 for a draft that cannot be changed (%s)", (reason) => {
    expect(draftEditErrorResponse(new DraftEditError("The plain reason.", reason))).toEqual({ status: 409, error: "The plain reason." });
  });

  it("answers 409 once the issue is published", () => {
    expect(draftEditErrorResponse(new IssuePublishedError(3, DATE))).toEqual({
      status: 409,
      error: `The issue for ${DATE} (id 3) is already published.`,
    });
  });

  it.each([
    ["an unexpected error", new Error("database down")],
    ["a unique clash that was not turned into a taken title", Object.assign(new Error("Unique constraint failed"), { code: "P2002" })],
    ["a thrown string", "boom"],
    ["nothing", null],
  ])("leaves %s to the route", (_name, error) => {
    expect(draftEditErrorResponse(error)).toBeNull();
  });
});
