import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

// Netlify reads APP_ENV per deploy context from netlify.toml. A missing context would fail that deploy's build.
const toml = readFileSync(path.resolve(__dirname, "../../netlify.toml"), "utf8");

function appEnvFor(context: string): string | undefined {
  const section = toml.split(/^\[/m).find((block) => block.startsWith(`context.${context}.environment]`));
  return section?.match(/^\s*APP_ENV\s*=\s*"([^"]*)"/m)?.[1];
}

describe("netlify.toml APP_ENV", () => {
  it.each([
    ["production", "production"],
    ["deploy-preview", "preview"],
    ["branch-deploy", "preview"],
    ["staging", "preview"],
  ])("sets APP_ENV for the %s context to %s", (context, expected) => {
    expect(appEnvFor(context)).toBe(expected);
  });
});
