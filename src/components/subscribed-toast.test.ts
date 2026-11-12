import { describe, expect, it } from "vitest";

import { SUBSCRIBED_TOAST_EVENT, announceSubscribed, takeSubscribedToast } from "@/src/components/subscribed-toast";

function fakeStorage() {
  const items = new Map<string, string>();
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
    removeItem: (key: string) => void items.delete(key),
  } as Storage;
}

describe("the Subscribed! toast", () => {
  it("is shown once after a subscribe announces it, on this page or the next one", () => {
    const storage = fakeStorage();
    const target = new EventTarget();
    const heard: string[] = [];
    target.addEventListener(SUBSCRIBED_TOAST_EVENT, (event) => heard.push(event.type));

    announceSubscribed(storage, target);

    expect(heard).toEqual([SUBSCRIBED_TOAST_EVENT]);
    expect(takeSubscribedToast(storage)).toBe(true);
    expect(takeSubscribedToast(storage)).toBe(false);
  });

  it("is not shown when nobody subscribed", () => {
    expect(takeSubscribedToast(fakeStorage())).toBe(false);
  });
});
