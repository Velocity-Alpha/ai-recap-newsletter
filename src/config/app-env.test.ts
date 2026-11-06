import { describe, expect, it } from "vitest";

import { APP_ENVS, parseAppEnv } from "./app-env.mjs";

describe("parseAppEnv", () => {
  it.each(APP_ENVS)("accepts %s", (value) => {
    expect(parseAppEnv(value)).toBe(value);
  });

  it("trims surrounding whitespace", () => {
    expect(parseAppEnv(" preview \n")).toBe("preview");
  });

  it("fails fast when APP_ENV is missing or empty", () => {
    for (const value of [undefined, "", "   "]) {
      expect(() => parseAppEnv(value)).toThrow(
        "APP_ENV is required. Set it to one of: development, preview, production.",
      );
    }
  });

  it("rejects any other value, including near misses", () => {
    for (const value of ["prod", "staging", "Production", "test"]) {
      expect(() => parseAppEnv(value)).toThrow(
        `APP_ENV must be one of: development, preview, production. Got "${value}".`,
      );
    }
  });
});
