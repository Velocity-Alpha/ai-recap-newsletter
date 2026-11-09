import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");

// Netlify's function bundler marks "@prisma/client" as external, and esbuild
// matches that as a prefix, so every "@prisma/client*" package the generated
// client requires stays external. Netlify does not copy all of them into the
// function (see netlify.toml), so each one must be in included_files.
describe("Netlify function bundle", () => {
  it("ships every @prisma/client* package the generated client requires", () => {
    const runtime = readFileSync(path.join(root, "src/generated/prisma/runtime/client.js"), "utf8");
    const required = new Set(
      [...runtime.matchAll(/require\("(@prisma\/client[^"/]*)"\)/g)].map((match) => match[1]),
    );
    const netlifyToml = readFileSync(path.join(root, "netlify.toml"), "utf8");

    expect(required.size).toBeGreaterThan(0);
    for (const name of required) {
      expect(netlifyToml).toContain(`"node_modules/${name}/**"`);
    }
  });

  it("covers every function file with an included_files block", () => {
    const netlifyToml = readFileSync(path.join(root, "netlify.toml"), "utf8");
    const patterns = [...netlifyToml.matchAll(/\[functions\."([^"]+)"\]\s*\n\s*included_files = \[[^\]]*client-runtime-utils/g)].map(
      (match) => new RegExp(`^${match[1].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`),
    );
    const functions = readdirSync(path.join(root, "netlify/functions"))
      .filter((file) => /\.m?[jt]s$/.test(file))
      .map((file) => file.replace(/\.m?[jt]s$/, ""));

    expect(functions.length).toBeGreaterThan(0);
    for (const name of functions) {
      expect(patterns.some((pattern) => pattern.test(name)), name).toBe(true);
    }
  });
});
