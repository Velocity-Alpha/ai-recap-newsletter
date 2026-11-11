import { describe, expect, it } from "vitest";

import { paywalledLinks, selectedLinkState, typedLinkOf } from "@/src/components/approval/story-links";

const slot = (id: number, status: "selected" | "fill-in" = "selected") => ({ story: { id, headline: `Story ${id}` }, status });

function board(overrides: Partial<Parameters<typeof paywalledLinks>[0]> = {}): Parameters<typeof paywalledLinks>[0] {
  return {
    sections: [
      { stories: [slot(1), slot(2)] },
      { stories: [slot(3), slot(4, "fill-in")] },
    ],
    excludeState: {},
    urlOverrides: {},
    linkState: {},
    candidateMap: {
      "1": { url: "https://www.wsj.com/tech/one", paywall_detected: "yes" },
      "2": { url: "https://free.example/two", paywall_detected: "no" },
      "3": { url: "https://ft.com/three", paywall_detected: "yes" },
      "4": { url: "https://www.bloomberg.com/four", paywall_detected: "yes" },
    },
    ...overrides,
  };
}

describe("selectedLinkState", () => {
  it("is the state of the link the reviewer selected or typed, when there is one", () => {
    expect(selectedLinkState(1, { 1: "no" }, "yes")).toBe("no");
    expect(selectedLinkState(1, { 1: "error" }, "no")).toBe("error");
  });

  it("is the stored state of the original link otherwise, and unknown when nothing is stored", () => {
    expect(selectedLinkState(1, {}, "yes")).toBe("yes");
    expect(selectedLinkState(1, { 2: "no" }, undefined)).toBe("unknown");
  });
});

describe("typedLinkOf", () => {
  it("is the typed link, without the spaces around it", () => {
    expect(typedLinkOf(" https://free.example/a ", "https://www.wsj.com/a")).toBe("https://free.example/a");
    expect(typedLinkOf("https://free.example/a", null)).toBe("https://free.example/a");
  });

  it("is null when the field is empty or holds the story's own link again", () => {
    expect(typedLinkOf("  ", "https://www.wsj.com/a")).toBeNull();
    expect(typedLinkOf("https://www.wsj.com/a", "https://www.wsj.com/a")).toBeNull();
  });
});

describe("paywalledLinks", () => {
  it("lists the selected stories whose link is paywalled, in board order, with the link's site", () => {
    expect(paywalledLinks(board())).toEqual([
      { id: 1, headline: "Story 1", site: "wsj.com" },
      { id: 3, headline: "Story 3", site: "ft.com" },
    ]);
  });

  it("leaves out fill-ins and excluded stories: they are not in the outline", () => {
    const links = paywalledLinks(board({ excludeState: { 1: { excluded: true } } }));

    expect(links.map((link) => link.id)).toEqual([3]);
  });

  it("leaves out a story whose new link was checked and is not paywalled", () => {
    const links = paywalledLinks(board({ urlOverrides: { 1: "https://free.example/one" }, linkState: { 1: "no" } }));

    expect(links.map((link) => link.id)).toEqual([3]);
  });

  it("lists a story with a free original link when the reviewer typed a paywalled one", () => {
    const links = paywalledLinks(board({ urlOverrides: { 2: "https://www.nytimes.com/two" }, linkState: { 2: "yes" } }));

    expect(links).toContainEqual({ id: 2, headline: "Story 2", site: "nytimes.com" });
  });

  it("lists nothing when no selected link is paywalled", () => {
    expect(paywalledLinks(board({ linkState: { 1: "unknown", 3: "no" } }))).toEqual([]);
  });
});
