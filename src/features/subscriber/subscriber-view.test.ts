import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { SIGNED_IN_HINT_COOKIE } from "@/src/features/subscriber/signed-in-hint";
import {
  ARTICLE_LOCK_CLIP_ATTRIBUTE,
  SIGNED_OUT_ONLY_ATTRIBUTE,
  SUBSCRIBER_VIEW_ATTRIBUTE,
  SUBSCRIBER_VIEW_HEAD_SCRIPT,
  hasSignedInHint,
  markSubscriberView,
  unmarkSubscriberView,
} from "@/src/features/subscriber/subscriber-view";

function fakeDocument(cookie: string) {
  const attributes = new Map<string, string>();
  const documentElement = {
    setAttribute: (name: string, value: string) => attributes.set(name, value),
    removeAttribute: (name: string) => attributes.delete(name),
  };
  return { cookie, documentElement, attributes };
}

function runHeadScript(document: ReturnType<typeof fakeDocument>) {
  new Function("document", SUBSCRIBER_VIEW_HEAD_SCRIPT)(document);
}

describe("hasSignedInHint", () => {
  it.each([
    ["only the hint", `${SIGNED_IN_HINT_COOKIE}=1`],
    ["the hint among other cookies", `_ga=GA1.1; ${SIGNED_IN_HINT_COOKIE}=1; theme=light`],
  ])("is true for %s", (_label, cookie) => {
    expect(hasSignedInHint(cookie)).toBe(true);
  });

  it.each([
    ["no cookies", ""],
    ["other cookies only", "_ga=GA1.1; theme=light"],
    ["a cleared hint", `${SIGNED_IN_HINT_COOKIE}=`],
    ["a different value", `${SIGNED_IN_HINT_COOKIE}=0`],
    ["a cookie whose name only ends with the hint name", `x${SIGNED_IN_HINT_COOKIE}=1`],
  ])("is false for %s", (_label, cookie) => {
    expect(hasSignedInHint(cookie)).toBe(false);
  });
});

describe("subscriber view head script", () => {
  it("marks the page as subscriber view when the hint cookie is present", () => {
    const document = fakeDocument(`theme=light; ${SIGNED_IN_HINT_COOKIE}=1`);

    runHeadScript(document);

    expect(document.attributes.has(SUBSCRIBER_VIEW_ATTRIBUTE)).toBe(true);
  });

  it("leaves the signed-out view when the hint cookie is missing", () => {
    const document = fakeDocument("theme=light");

    runHeadScript(document);

    expect(document.attributes.has(SUBSCRIBER_VIEW_ATTRIBUTE)).toBe(false);
  });
});

describe("subscriber view CSS", () => {
  it("hides signed-out-only elements and lifts the article lock clip in the subscriber view", () => {
    const css = readFileSync(path.resolve(__dirname, "../../../app/globals.css"), "utf8");

    expect(css).toMatch(
      new RegExp(`html\\[${SUBSCRIBER_VIEW_ATTRIBUTE}\\] \\[${SIGNED_OUT_ONLY_ATTRIBUTE}\\] \\{\\s*display: none !important;`),
    );
    expect(css).toMatch(
      new RegExp(`html\\[${SUBSCRIBER_VIEW_ATTRIBUTE}\\] \\[${ARTICLE_LOCK_CLIP_ATTRIBUTE}\\] \\{\\s*max-height: none !important;`),
    );
  });
});

describe("mark and unmark the subscriber view", () => {
  it("marks the page, then unmarks it and clears the hint cookie", () => {
    const document = fakeDocument("");

    markSubscriberView(document as unknown as Document);
    expect(document.attributes.has(SUBSCRIBER_VIEW_ATTRIBUTE)).toBe(true);

    unmarkSubscriberView(document as unknown as Document);
    expect(document.attributes.has(SUBSCRIBER_VIEW_ATTRIBUTE)).toBe(false);
    expect(document.cookie).toMatch(new RegExp(`^${SIGNED_IN_HINT_COOKIE}=;`));
    expect(document.cookie).toContain("max-age=0");
    expect(document.cookie).toContain("path=/");
  });
});
