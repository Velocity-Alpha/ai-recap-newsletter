import { describe, expect, it, vi } from "vitest";

import { checkLink, watchFreeLinks, type FreeLinksByStory } from "@/src/features/newsletter/free-links-client";

function reply(body: unknown, ok = true) {
  return { ok, json: async () => body } as Response;
}

describe("checkLink", () => {
  it("asks the server about the link and returns its paywall state", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ paywall: "yes" }));

    await expect(checkLink("https://news.example/a", { fetcher })).resolves.toBe("yes");
    expect(fetcher).toHaveBeenCalledWith("/api/approval/check-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: "https://news.example/a" }),
    });
  });

  it.each(["no", "unknown", "error"] as const)("passes the state %s through", async (state) => {
    await expect(checkLink("https://news.example/a", { fetcher: vi.fn().mockResolvedValue(reply({ paywall: state })) })).resolves.toBe(state);
  });

  it("answers error for a refused request", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ error: "Unauthorized." }, false));

    await expect(checkLink("https://news.example/a", { fetcher })).resolves.toBe("error");
  });

  it("answers error for a reply it does not know", async () => {
    const fetcher = vi.fn().mockResolvedValue(reply({ paywall: "maybe" }));

    await expect(checkLink("https://news.example/a", { fetcher })).resolves.toBe("error");
  });

  it("answers error for a request that failed", async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error("offline"));

    await expect(checkLink("https://news.example/a", { fetcher })).resolves.toBe("error");
  });
});

describe("watchFreeLinks", () => {
  const LINK = { url: "https://free.example/a", site: "free.example", title: "A", words: 500 };

  /** A server that answers the start with `startOk`, and each read with the next of `reads` (the last one again). */
  function server(reads: Array<FreeLinksByStory | "fail">, startOk = true) {
    let next = 0;
    const fetcher = vi.fn(async (_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return reply({ started: 1 }, startOk);
      const answer = reads[Math.min(next, reads.length - 1)];
      next += 1;
      return answer === "fail" ? reply({ error: "down" }, false) : reply({ stories: answer });
    });
    const wait = vi.fn(async () => undefined);
    const onUpdate = vi.fn();
    return { fetcher, wait, onUpdate, reads: () => next };
  }

  it("starts the search for the stories", async () => {
    const { fetcher, wait, onUpdate } = server([{ 1: { done: true, links: [] }, 2: { done: true, links: [] } }]);

    await watchFreeLinks([1, 2], { fetcher, wait, onUpdate });

    expect(fetcher).toHaveBeenCalledWith("/api/approval/free-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ story_ids: [1, 2] }),
    });
    expect(fetcher).toHaveBeenCalledWith("/api/approval/free-links?ids=1,2");
  });

  it("reports each read and stops when every story is done", async () => {
    const first = { 1: { done: true, links: [LINK] }, 2: { done: false, links: [] } };
    const second = { 1: { done: true, links: [LINK] }, 2: { done: true, links: [] } };
    const { fetcher, wait, onUpdate, reads } = server([first, second]);

    await watchFreeLinks([1, 2], { fetcher, wait, onUpdate });

    expect(onUpdate.mock.calls).toEqual([[first], [second]]);
    expect(reads()).toBe(2);
    expect(wait).toHaveBeenCalledTimes(1);
    expect(wait).toHaveBeenCalledWith(3_000);
  });

  it("gives up after 2 minutes, and reports the stories as done with the links found so far", async () => {
    const { fetcher, wait, onUpdate, reads } = server([{ 1: { done: false, links: [LINK] } }]);

    await watchFreeLinks([1], { fetcher, wait, onUpdate });

    expect(wait).toHaveBeenCalledTimes(40);
    expect(reads()).toBe(41);
    expect(onUpdate).toHaveBeenLastCalledWith({ 1: { done: true, links: [LINK] } });
  });

  it("reads once, with no wait, when the search did not start", async () => {
    const { fetcher, wait, onUpdate, reads } = server([{ 1: { done: false, links: [] } }], false);

    await watchFreeLinks([1], { fetcher, wait, onUpdate });

    expect(reads()).toBe(1);
    expect(wait).not.toHaveBeenCalled();
    expect(onUpdate.mock.calls).toEqual([[{ 1: { done: true, links: [] } }]]);
  });

  it("goes on after a read that failed", async () => {
    const done = { 1: { done: true, links: [LINK] } };
    const { fetcher, wait, onUpdate } = server(["fail", done]);

    await watchFreeLinks([1], { fetcher, wait, onUpdate });

    expect(onUpdate.mock.calls).toEqual([[done]]);
  });

  it("does nothing for no stories", async () => {
    const { fetcher, wait, onUpdate } = server([{}]);

    await watchFreeLinks([], { fetcher, wait, onUpdate });

    expect(fetcher).not.toHaveBeenCalled();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
