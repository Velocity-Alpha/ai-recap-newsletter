import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import { storyFreeLinks } from "@/src/pipeline/free-links/read-free-links";

const LINK = { url: "https://free.example/a", site: "free.example", title: "A", words: 500 };
const AT = new Date("2026-11-10T12:00:00Z");

describe("storyFreeLinks", () => {
  it("is not done while a paywalled story was not searched", () => {
    expect(storyFreeLinks({ paywallDetected: "yes", freeLinksCheckedAt: null }, [])).toEqual({ done: false, links: [] });
  });

  it("is done, with the links, once the story was searched", () => {
    expect(storyFreeLinks({ paywallDetected: "yes", freeLinksCheckedAt: AT }, [LINK])).toEqual({ done: true, links: [LINK] });
  });

  it("is done, with no links, for a story whose link is not paywalled", () => {
    expect(storyFreeLinks({ paywallDetected: "no", freeLinksCheckedAt: AT }, [LINK])).toEqual({ done: true, links: [] });
  });

  it("is done, with no links, for a story that does not exist", () => {
    expect(storyFreeLinks(undefined, [])).toEqual({ done: true, links: [] });
  });
});
