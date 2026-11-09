import { describe, expect, it } from "vitest";

import { checkArticleText, MIN_ARTICLE_CHARS, statusForHttp } from "@/src/pipeline/draft/articles/quality";

/** Invented filler prose of about `chars` characters. */
function prose(chars: number): string {
  const sentence = "The pretend lab trained a toy model on synthetic data and shared the made-up results. ";
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars).trim();
}

describe("checkArticleText", () => {
  it("accepts 500 or more characters of text from a page under HTTP 400", () => {
    expect(MIN_ARTICLE_CHARS).toBe(500);
    expect(checkArticleText(prose(600), 200)).toEqual({ ok: true });
  });

  it("fails short text", () => {
    expect(checkArticleText(prose(300), 200)).toEqual({ ok: false, status: "failed", reason: "Only 300 characters of text." });
  });

  it.each([
    [404, "failed"],
    [500, "failed"],
    [401, "blocked"],
    [403, "blocked"],
    [429, "blocked"],
    [402, "paywalled"],
  ] as const)("fails HTTP %i as %s, whatever the text", (status, verdict) => {
    expect(checkArticleText(prose(3_000), status)).toEqual({ ok: false, status: verdict, reason: `HTTP ${status}.` });
    expect(statusForHttp(status)).toBe(verdict);
  });

  it.each(["Just a moment...", "Please verify you are human to continue.", "Complete the CAPTCHA below.", "Checking your browser before accessing the site."])(
    "calls a short text with %j a block page",
    (phrase) => {
      expect(checkArticleText(`${prose(800)} ${phrase}`, 200)).toEqual({ ok: false, status: "blocked", reason: "A bot check or block page." });
    },
  );

  it("only looks for block phrases in texts under 2,500 characters, since long pages mention captcha in cookie banners", () => {
    expect(checkArticleText(`${prose(2_600)} This site uses captcha cookies.`, 200)).toEqual({ ok: true });
  });

  it.each(["Subscribe to continue reading.", "This post is for paid subscribers", "You have reached your free article limit."])(
    "calls a text with %j paywalled",
    (phrase) => {
      expect(checkArticleText(`${prose(1_200)} ${phrase}`, 200)).toEqual({ ok: false, status: "paywalled", reason: "A paywall." });
    },
  );

  it("fails a short page that only says it needs JavaScript (a page shell)", () => {
    expect(checkArticleText(`${prose(700)} You need to enable JavaScript to run this app.`, 200)).toEqual({
      ok: false,
      status: "failed",
      reason: "A page shell that needs JavaScript.",
    });
  });

  it("names a block page even when it is short", () => {
    expect(checkArticleText("Just a moment...", 200)).toMatchObject({ status: "blocked" });
  });
});
