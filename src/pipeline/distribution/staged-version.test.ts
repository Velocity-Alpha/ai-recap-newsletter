import { describe, expect, it } from "vitest";

import { draftChangedSinceStaged, type StagedComparison } from "@/src/pipeline/distribution/staged-version";

const STAGED: StagedComparison = { draftId: 41, title: "Pretend Lab Plans A Week", featuredImageUrl: "https://assets.example.test/a.jpg" };

describe("draftChangedSinceStaged", () => {
  it("is false when the draft row, the title, and the image are the same", () => {
    expect(draftChangedSinceStaged({ ...STAGED }, STAGED)).toBe(false);
  });

  it("is true for a different draft row", () => {
    expect(draftChangedSinceStaged({ ...STAGED, draftId: 42 }, STAGED)).toBe(true);
  });

  it("is true for a different title", () => {
    expect(draftChangedSinceStaged({ ...STAGED, title: "Pretend Lab Plans A Month" }, STAGED)).toBe(true);
  });

  it("is true for a different image URL", () => {
    expect(draftChangedSinceStaged({ ...STAGED, featuredImageUrl: "https://assets.example.test/b.jpg" }, STAGED)).toBe(true);
  });

  it("treats a missing image and an empty image URL as the same", () => {
    expect(draftChangedSinceStaged({ ...STAGED, featuredImageUrl: null }, { ...STAGED, featuredImageUrl: "" })).toBe(false);
  });
});
