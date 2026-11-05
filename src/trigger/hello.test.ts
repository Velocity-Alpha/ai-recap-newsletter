import { describe, expect, it } from "vitest";

import { buildHelloMessage } from "./hello";

describe("buildHelloMessage", () => {
  const now = new Date("2026-11-05T15:00:00.000Z");

  it("greets the given name and stamps the time", () => {
    expect(buildHelloMessage({ name: "AI Recap" }, now)).toEqual({
      message: "Hello, AI Recap. The Trigger.dev runner is working.",
      at: "2026-11-05T15:00:00.000Z",
    });
  });

  it("falls back to a default name", () => {
    expect(buildHelloMessage({}, now).message).toBe(
      "Hello, world. The Trigger.dev runner is working.",
    );
  });
});
