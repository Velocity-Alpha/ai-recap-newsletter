import { describe, expect, it } from "vitest";

import { getArticlePreviewHeight } from "@/components/articlePreview";

describe("getArticlePreviewHeight", () => {
  it("uses a smaller preview height on mobile", () => {
    expect(getArticlePreviewHeight(390)).toBe(960);
  });

  it("uses a medium preview height on tablet widths", () => {
    expect(getArticlePreviewHeight(900)).toBe(1120);
  });

  it("uses the largest preview height on desktop", () => {
    expect(getArticlePreviewHeight(1440)).toBe(1320);
  });
});
