import { describe, expect, it } from "vitest";

import {
  draftHtmlSrc,
  DraftRequestError,
  draftViewHref,
  isRefusal,
  jsonPost,
  nativeCommitTarget,
  secondCommitNotice,
} from "@/src/features/newsletter/draft-links";

describe("jsonPost", () => {
  // The approval API refuses writes that are not JSON (415) once the Origin check (#128) is on.
  it("sends a JSON POST, with an empty object when there is no body", () => {
    expect(jsonPost()).toEqual({ method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(jsonPost({ scenePrompt: "A lamp." })).toEqual({
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ scenePrompt: "A lamp." }),
    });
  });
});

describe("draft links", () => {
  it("points at the draft view and the preview HTML", () => {
    expect(draftViewHref("2026-05-21")).toBe("/approval/drafts?date=2026-05-21");
    expect(draftViewHref("2026-05-21", 41)).toBe("/approval/drafts?date=2026-05-21&draft=41");
    expect(draftHtmlSrc(41)).toBe("/api/approval/drafts/41/html");
  });
});

describe("secondCommitNotice", () => {
  it("warns before a second native commit for a date that the new draft replaces the current one", () => {
    expect(secondCommitNotice({ drafts: [{ id: 40, version: 1, status: "ready" }], nextVersion: 2 })).toBe(
      "This makes a new draft. It replaces the current draft as the one to review and stage.",
    );
  });

  it("names no draft number (the owner sees only staged version numbers) and no distribution service", () => {
    const notice = secondCommitNotice({
      drafts: [
        { id: 41, version: 2, status: "failed" },
        { id: 40, version: 1, status: "ready" },
      ],
      nextVersion: 3,
    });

    expect(notice).toBe("This makes a new draft. It replaces the current draft as the one to review and stage.");
    expect(notice).not.toMatch(/v\d/);
    expect(notice).not.toContain("GHL");
  });

  it("says nothing for the first commit", () => {
    expect(secondCommitNotice({ drafts: [], nextVersion: 1 })).toBeNull();
    expect(secondCommitNotice(null)).toBeNull();
  });
});

describe("DraftRequestError", () => {
  it("carries the plain message and the HTTP status, and only a 409 is a refusal", () => {
    const refused = new DraftRequestError("The issue is already published.", 409);

    expect(refused).toBeInstanceOf(Error);
    expect(refused).toMatchObject({ name: "DraftRequestError", message: "The issue is already published.", status: 409 });
    expect(isRefusal(refused)).toBe(true);
    expect(isRefusal(new DraftRequestError("Staging failed.", 502))).toBe(false);
    expect(isRefusal(new DraftRequestError("Could not reach the server. Try again.", null))).toBe(false);
    expect(isRefusal(new Error("The issue is already published."))).toBe(false);
    expect(isRefusal("409")).toBe(false);
  });
});

describe("nativeCommitTarget", () => {
  it("follows the draft a native commit made, even when its job did not start", () => {
    expect(nativeCommitTarget({ success: true, draft: { draftId: 41 } }, "2026-05-21")).toBe(
      "/approval/drafts?date=2026-05-21&draft=41",
    );
    expect(nativeCommitTarget({ success: false, draft: { draftId: 41 } }, "2026-05-21")).toBe(
      "/approval/drafts?date=2026-05-21&draft=41",
    );
  });

  it("is null for a commit that made no draft", () => {
    expect(nativeCommitTarget({ success: true, message: "Outline committed to generation webhook." }, "2026-05-21")).toBeNull();
    expect(nativeCommitTarget({ success: false, error: "already published" }, "2026-05-21")).toBeNull();
    expect(nativeCommitTarget(null, "2026-05-21")).toBeNull();
  });
});
