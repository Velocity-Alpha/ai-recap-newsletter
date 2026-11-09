import { describe, expect, it } from "vitest";

import {
  draftHtmlSrc,
  draftViewHref,
  nativeCommitTarget,
  secondCommitNotice,
} from "@/src/features/newsletter/draft-links";

describe("draft links", () => {
  it("points at the draft view and the preview HTML", () => {
    expect(draftViewHref("2026-05-21")).toBe("/approval/drafts?date=2026-05-21");
    expect(draftViewHref("2026-05-21", 41)).toBe("/approval/drafts?date=2026-05-21&draft=41");
    expect(draftHtmlSrc(41)).toBe("/api/approval/drafts/41/html");
  });
});

describe("secondCommitNotice", () => {
  it("warns before a second native commit for a date", () => {
    expect(secondCommitNotice({ owner: "native", drafts: [{ id: 40, version: 1, status: "ready" }], nextVersion: 2 })).toBe(
      "This makes draft v2 and a new GHL template. Earlier drafts stay in GHL.",
    );
  });

  it("says nothing for the first commit, or while n8n drafts", () => {
    expect(secondCommitNotice({ owner: "native", drafts: [], nextVersion: 1 })).toBeNull();
    expect(secondCommitNotice({ owner: "n8n", drafts: [], nextVersion: 1 })).toBeNull();
    expect(secondCommitNotice(null)).toBeNull();
  });
});

describe("nativeCommitTarget", () => {
  it("follows the draft a native commit made, even when its job did not start", () => {
    expect(nativeCommitTarget({ success: true, owner: "native", draft: { draftId: 41 } }, "2026-05-21")).toBe(
      "/approval/drafts?date=2026-05-21&draft=41",
    );
    expect(nativeCommitTarget({ success: false, owner: "native", draft: { draftId: 41 } }, "2026-05-21")).toBe(
      "/approval/drafts?date=2026-05-21&draft=41",
    );
  });

  it("is null for an n8n commit or a refused one", () => {
    expect(nativeCommitTarget({ success: true, message: "Outline committed to generation webhook." }, "2026-05-21")).toBeNull();
    expect(nativeCommitTarget({ success: false, error: "already published" }, "2026-05-21")).toBeNull();
    expect(nativeCommitTarget(null, "2026-05-21")).toBeNull();
  });
});
