import { describe, expect, it } from "vitest";

import { freeLinkPill,
  linkChoiceOf,
  linksToAutoSelect,
  ownerLinkEdits,
  paywalledLinks, selectedLinkState, typedLinkOf } from "@/src/components/approval/story-links";

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
  it("is the state of the link the owner typed, when there is one", () => {
    expect(selectedLinkState(1, { 1: "no" }, "yes")).toBe("no");
    expect(selectedLinkState(1, { 1: "error" }, "no")).toBe("error");
  });

  it("is the stored state of the original link when the owner typed no link", () => {
    expect(selectedLinkState(1, {}, "yes")).toBe("yes");
  });

  it("is unknown when the owner typed no link and nothing is stored", () => {
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

  it("lists a story with a free original link when the owner typed a paywalled one", () => {
    const links = paywalledLinks(board({ urlOverrides: { 2: "https://www.nytimes.com/two" }, linkState: { 2: "yes" } }));

    expect(links).toContainEqual({ id: 2, headline: "Story 2", site: "nytimes.com" });
  });

  it("lists nothing when no selected link is paywalled", () => {
    expect(paywalledLinks(board({ linkState: { 1: "unknown", 3: "no" } }))).toEqual([]);
  });
});

const FREE_LINKS = [
  { url: "https://free.example/a", site: "free.example", title: "A", words: 812 },
  { url: "https://other.example/b", site: "other.example", title: null, words: 400 },
];

describe("linkChoiceOf", () => {
  it("is the original link when the story has no link edit", () => {
    expect(linkChoiceOf(undefined, FREE_LINKS, false)).toEqual({ kind: "original" });
  });

  it("is the free link whose link the story has", () => {
    expect(linkChoiceOf("https://other.example/b", FREE_LINKS, false)).toEqual({ kind: "free", index: 1 });
  });

  it("is the other link when the story has a link that is not a free link", () => {
    expect(linkChoiceOf("https://typed.example/c", FREE_LINKS, false)).toEqual({ kind: "other" });
  });

  it("is the other link once the owner selected it, also with an empty field", () => {
    expect(linkChoiceOf(undefined, FREE_LINKS, true)).toEqual({ kind: "other" });
  });
});

describe("freeLinkPill", () => {
  const ORIGINAL = "https://www.wsj.com/story";

  it("is null for a story with no search", () => {
    expect(freeLinkPill(undefined, ORIGINAL, ORIGINAL)).toBeNull();
  });

  it("says that the search runs", () => {
    expect(freeLinkPill({ done: false, links: [] }, ORIGINAL, ORIGINAL)).toBe("finding free links…");
  });

  it("says that no free link was found", () => {
    expect(freeLinkPill({ done: true, links: [] }, ORIGINAL, ORIGINAL)).toBe("no free link found");
  });

  it("names the selected free link, its words and the site of the original link", () => {
    expect(freeLinkPill({ done: true, links: FREE_LINKS }, "https://free.example/a", ORIGINAL)).toBe(
      "free link: free.example, 812 words · original: wsj.com",
    );
  });

  it("counts the free links when another link is selected", () => {
    expect(freeLinkPill({ done: true, links: FREE_LINKS }, ORIGINAL, ORIGINAL)).toBe("2 free links found");
    expect(freeLinkPill({ done: true, links: FREE_LINKS.slice(0, 1) }, "https://typed.example/c", ORIGINAL)).toBe("1 free link found");
  });
});

describe("linksToAutoSelect", () => {
  const UPDATE = { 1: { done: true, links: FREE_LINKS }, 2: { done: true, links: [] }, 3: { done: false, links: FREE_LINKS } };

  it("gives the first free link of each story that is done and has one", () => {
    expect(linksToAutoSelect(UPDATE, new Set(), {})).toEqual({ 1: "https://free.example/a" });
  });

  it("leaves out a story whose link the owner changed", () => {
    expect(linksToAutoSelect(UPDATE, new Set([1]), {})).toEqual({});
  });

  it("leaves out a story the board selected a link for before", () => {
    expect(linksToAutoSelect(UPDATE, new Set(), { 1: "https://free.example/a" })).toEqual({});
  });
});

describe("ownerLinkEdits", () => {
  it("leaves out the free links the board selected by itself", () => {
    const urlOverrides = { 1: "https://free.example/a", 2: "https://typed.example/c" };

    expect(ownerLinkEdits(urlOverrides, { 1: "https://free.example/a" })).toEqual({ 2: "https://typed.example/c" });
  });

  it("keeps the link of a story where the owner selected another link after the board", () => {
    expect(ownerLinkEdits({ 1: "https://other.example/b" }, { 1: "https://free.example/a" })).toEqual({ 1: "https://other.example/b" });
  });
});
