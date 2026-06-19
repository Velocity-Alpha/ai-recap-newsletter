import { beforeEach, describe, expect, it, vi } from "vitest";

const findManyMock = vi.hoisted(() => vi.fn());

vi.mock("@/src/server/prisma", () => ({
  prisma: {
    story: {
      findMany: findManyMock,
    },
  },
}));

vi.mock("@/src/server/observability", () => ({
  logServerInfo: vi.fn(),
  logServerError: vi.fn(),
}));

import {
  cleanText,
  createApprovalOutlineDataWithoutDedup,
} from "@/src/features/newsletter/curation.service";

describe("newsletter curation", () => {
  beforeEach(() => {
    findManyMock.mockReset();
  });

  it("cleans markdown and URLs without injecting replacement placeholders", () => {
    expect(
      cleanText(
        "- **[OpenAI launches model](https://example.com)** read more at https://example.com"
      )
    ).toBe("OpenAI launches model");
  });

  it("maps reference stories using used_in_publication_date when present", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 101,
          guid: "guid-101",
          day: new Date("2026-06-05T00:00:00.000Z"),
          usedInPublicationDate: new Date("2026-06-08T00:00:00.000Z"),
          headline: "Published story",
          url: "https://example.com/published",
          summary: "Summary",
          category: "general",
          source: "source",
          storyDetails: "details",
          importanceScore: 3,
        },
      ])
      .mockResolvedValueOnce([]);

    const { outline } = await createApprovalOutlineDataWithoutDedup(
      new Date("2026-06-09T00:00:00.000Z")
    );

    expect(outline.reference_stories).toHaveLength(1);
    expect(outline.reference_stories[0]).toMatchObject({
      id: 101,
      usedInPublicationDate: "2026-06-08",
      headline: "Published story",
      summary: "Summary",
    });
  });

  it("keeps usedInPublicationDate null when missing", async () => {
    findManyMock
      .mockResolvedValueOnce([
        {
          id: 202,
          guid: "guid-202",
          day: new Date("2026-06-04T00:00:00.000Z"),
          usedInPublicationDate: null,
          headline: "Story without publication date",
          url: "https://example.com/no-date",
          summary: "Summary",
          category: "general",
          source: "source",
          storyDetails: "details",
          importanceScore: 3,
        },
      ])
      .mockResolvedValueOnce([]);

    const { outline } = await createApprovalOutlineDataWithoutDedup(
      new Date("2026-06-09T00:00:00.000Z")
    );

    expect(outline.reference_stories).toHaveLength(1);
    expect(outline.reference_stories[0]).toMatchObject({
      id: 202,
      usedInPublicationDate: null,
      headline: "Story without publication date",
      summary: "Summary",
    });
  });
});
