import { describe, expect, it } from "vitest";

import { safeRedirectPath } from "@/src/lib/safe-redirect";

const ORIGIN = "https://ai-recap.example";

describe("safeRedirectPath", () => {
  it("keeps paths on this site, with their query and hash", () => {
    expect(safeRedirectPath("/approval/issues", ORIGIN)).toBe("/approval/issues");
    expect(safeRedirectPath("/approval?tab=2#top", ORIGIN)).toBe("/approval?tab=2#top");
  });

  it.each([
    "//other.example/approval",
    "/\\other.example",
    "\\\\other.example",
    "/\t/other.example",
    "https://other.example/approval",
    "http://ai-recap.example/approval",
    "javascript:alert(1)",
    "data:text/html,hi",
  ])("falls back for %j, which leaves the site", (raw) => {
    expect(safeRedirectPath(raw, ORIGIN)).toBe("/approval");
  });

  it("falls back when there is no redirect", () => {
    expect(safeRedirectPath(null, ORIGIN)).toBe("/approval");
    expect(safeRedirectPath("", ORIGIN)).toBe("/approval");
  });

  it("uses the given fallback", () => {
    expect(safeRedirectPath("//other.example", ORIGIN, "/")).toBe("/");
  });
});
