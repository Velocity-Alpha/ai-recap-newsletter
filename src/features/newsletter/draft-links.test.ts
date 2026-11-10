import { describe, expect, it } from "vitest";

import {
  draftHtmlSrc,
  draftViewHref,
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
      "This makes draft v2. It replaces the current draft as the one to review and stage.",
    );
  });

  it("names the version the commit makes, and no distribution service", () => {
    const notice = secondCommitNotice({
      drafts: [
        { id: 41, version: 2, status: "failed" },
        { id: 40, version: 1, status: "ready" },
      ],
      nextVersion: 3,
    });

    expect(notice).toBe("This makes draft v3. It replaces the current draft as the one to review and stage.");
    expect(notice).not.toContain("GHL");
  });

  it("says nothing for the first commit", () => {
    expect(secondCommitNotice({ drafts: [], nextVersion: 1 })).toBeNull();
    expect(secondCommitNotice(null)).toBeNull();
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
