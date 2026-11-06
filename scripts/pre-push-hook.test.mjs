import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const hookPath = path.join(repoRoot, ".githooks", "pre-push");

const SHA = "a".repeat(40);
const ZERO = "0".repeat(40);

let binDir;
let callLog;

// Stands in for npm: records how the hook called it instead of running the real checks.
function installFakeNpm(exitCode) {
  writeFileSync(
    path.join(binDir, "npm"),
    `#!/bin/sh\necho "APP_ENV=$APP_ENV npm $*" >> "${callLog}"\nexit ${exitCode}\n`,
    { mode: 0o755 },
  );
}

// Git passes the remote name and URL as arguments and one line per pushed ref on stdin.
function runHook(stdin, extraEnv = {}) {
  const env = { ...process.env, ...extraEnv, PATH: `${binDir}${path.delimiter}${process.env.PATH}` };
  if (!("APP_ENV" in extraEnv)) delete env.APP_ENV;

  return spawnSync("sh", [hookPath, "origin", "git@github.com:example/repo.git"], {
    input: stdin,
    env,
    encoding: "utf8",
  });
}

describe(".githooks/pre-push", () => {
  beforeEach(() => {
    binDir = mkdtempSync(path.join(tmpdir(), "pre-push-hook-"));
    callLog = path.join(binDir, "calls.log");
  });

  afterEach(() => {
    rmSync(binDir, { recursive: true, force: true });
  });

  it("runs lint, tests and the build the way a deploy preview does before a branch is pushed", () => {
    installFakeNpm(0);

    const result = runHook(`refs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n`);

    expect(result.status).toBe(0);
    expect(readFileSync(callLog, "utf8").trim()).toBe("APP_ENV=preview npm run verify");
  });

  it("blocks the push when a check fails", () => {
    installFakeNpm(1);

    const result = runHook(`refs/heads/feat ${SHA} refs/heads/feat ${SHA.replace(/a/g, "b")}\n`);

    expect(result.status).not.toBe(0);
  });

  it("keeps an APP_ENV that is already set", () => {
    installFakeNpm(0);

    runHook(`refs/heads/feat ${SHA} refs/heads/feat ${ZERO}\n`, { APP_ENV: "development" });

    expect(readFileSync(callLog, "utf8").trim()).toBe("APP_ENV=development npm run verify");
  });

  it("skips the checks when the push only deletes a branch", () => {
    installFakeNpm(1);

    const result = runHook(`(delete) ${ZERO} refs/heads/old ${SHA}\n`);

    expect(result.status).toBe(0);
    expect(existsSync(callLog)).toBe(false);
  });

  it("is executable, so git runs it", () => {
    expect(statSync(hookPath).mode & 0o111).not.toBe(0);
  });

  it("is switched on by npm install", () => {
    const { scripts } = JSON.parse(readFileSync(path.join(repoRoot, "package.json"), "utf8"));

    expect(scripts.prepare).toContain("git config core.hooksPath .githooks");
  });
});
