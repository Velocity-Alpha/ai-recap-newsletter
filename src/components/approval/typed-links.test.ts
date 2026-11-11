import { describe, expect, it, vi } from "vitest";

import { createTypedLinks } from "@/src/components/approval/typed-links";
import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

const STORY_URL = "https://www.wsj.com/story";

/** Typed links with a check the test answers by hand. */
function setup() {
  const answers: Array<{ url: string; answer: (state: PaywallStatus) => void }> = [];
  const checkLink = vi.fn((url: string) => new Promise<PaywallStatus>((resolve) => answers.push({ url, answer: resolve })));
  const onStates = vi.fn();
  const onDropped = vi.fn();
  return { links: createTypedLinks({ checkLink, onStates, onDropped }), answers, checkLink, onStates, onDropped };
}

describe("typed links", () => {
  it("gives a typed link the state unknown until it is checked", () => {
    const { links, checkLink, onStates } = setup();

    links.type(1, "https://free.example/a");

    expect(links.states()).toEqual({ 1: "unknown" });
    expect(onStates).toHaveBeenLastCalledWith({ 1: "unknown" });
    expect(checkLink).not.toHaveBeenCalled();
  });

  it("checks the trimmed link when the owner leaves the field, and keeps the answer", async () => {
    const { links, answers, onStates } = setup();
    links.type(1, "  https://walled.example/a ");

    const finished = links.finish(1, STORY_URL);
    expect(answers[0].url).toBe("https://walled.example/a");
    answers[0].answer("yes");
    await finished;

    expect(links.states()).toEqual({ 1: "yes" });
    expect(onStates).toHaveBeenLastCalledWith({ 1: "yes" });
  });

  it("asks once when the owner leaves the field twice with the same link", async () => {
    const { links, answers, checkLink } = setup();
    links.type(1, "https://free.example/a");

    const first = links.finish(1, STORY_URL);
    await links.finish(1, STORY_URL);
    answers[0].answer("no");
    await first;
    await links.finish(1, STORY_URL);

    expect(checkLink).toHaveBeenCalledTimes(1);
  });

  it("drops the answer for a link the owner changed while the check ran", async () => {
    const { links, answers } = setup();
    links.type(1, "https://walled.example/a");
    const first = links.finish(1, STORY_URL);

    links.type(1, "https://free.example/b");
    answers[0].answer("yes");
    await first;

    expect(links.states()).toEqual({ 1: "unknown" });
  });

  it("drops the edit when the owner typed the story's own link again", async () => {
    const { links, checkLink, onDropped } = setup();
    links.type(1, "https://free.example/a");

    links.type(1, ` ${STORY_URL} `);
    await links.finish(1, STORY_URL);

    expect(links.states()).toEqual({});
    expect(onDropped).toHaveBeenCalledWith(1);
    expect(checkLink).not.toHaveBeenCalled();
  });

  it("drops the edit when the owner emptied the field", async () => {
    const { links, onDropped } = setup();
    links.type(1, "   ");

    await links.finish(1, STORY_URL);

    expect(links.states()).toEqual({});
    expect(onDropped).toHaveBeenCalledWith(1);
  });

  it("drops the answer for an edit the owner reverted while the check ran", async () => {
    const { links, answers } = setup();
    links.type(1, "https://walled.example/a");
    const first = links.finish(1, STORY_URL);

    links.type(1, STORY_URL);
    await links.finish(1, STORY_URL);
    answers[0].answer("yes");
    await first;

    expect(links.states()).toEqual({});
  });

  it("asks again for a link whose check failed", async () => {
    const { links, answers, checkLink } = setup();
    links.type(1, "https://free.example/a");
    const first = links.finish(1, STORY_URL);
    answers[0].answer("error");
    await first;
    expect(links.states()).toEqual({ 1: "error" });

    const second = links.finish(1, STORY_URL);
    answers[1].answer("no");
    await second;

    expect(checkLink).toHaveBeenCalledTimes(2);
    expect(links.states()).toEqual({ 1: "no" });
  });

  it("does nothing for a story with no typed link", async () => {
    const { links, checkLink, onDropped } = setup();

    await links.finish(1, STORY_URL);

    expect(checkLink).not.toHaveBeenCalled();
    expect(onDropped).not.toHaveBeenCalled();
  });

  it("settles only when every running check has its answer", async () => {
    const { links, answers } = setup();
    links.type(1, "https://walled.example/a");
    links.type(2, "https://free.example/b");
    void links.finish(1, STORY_URL);
    void links.finish(2, STORY_URL);
    let settled = false;
    const settling = links.settle().then(() => {
      settled = true;
    });

    answers[0].answer("yes");
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);

    answers[1].answer("no");
    await settling;
    expect(links.states()).toEqual({ 1: "yes", 2: "no" });
  });

  it("gives a selected free link its known state, with no check", () => {
    const { links, checkLink } = setup();

    links.select(1, "no");

    expect(links.states()).toEqual({ 1: "no" });
    expect(checkLink).not.toHaveBeenCalled();
  });

  it("drops the state of a story that went back to its original link", () => {
    const { links } = setup();
    links.select(1, "no");

    links.select(1, null);

    expect(links.states()).toEqual({});
  });

  it("drops the answer for a typed link when a free link was selected while the check ran", async () => {
    const { links, answers } = setup();
    links.type(1, "https://walled.example/a");
    const first = links.finish(1, STORY_URL);

    links.select(1, "no");
    answers[0].answer("yes");
    await first;

    expect(links.states()).toEqual({ 1: "no" });
  });

  it("settles at once when no check runs", async () => {
    await expect(setup().links.settle()).resolves.toBeUndefined();
  });
});
