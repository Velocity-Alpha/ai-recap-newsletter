import { describe, expect, it } from "vitest";

import {
  FAKE_SUBSCRIBERS,
  assertSafeReset,
  buildScrubStatements,
  checkScrubResult,
} from "./reset-dev-branch.mjs";

const production = { id: "br-prod", name: "production", default: true, protected: false, parent_id: null };
const dev = { id: "br-dev", name: "dev", default: false, protected: false, parent_id: "br-prod" };

describe("assertSafeReset", () => {
  it("accepts a dev branch whose parent is production", () => {
    expect(assertSafeReset([production, dev], { source: "production", target: "dev" })).toEqual({
      sourceBranch: production,
      targetBranch: dev,
    });
  });

  it("refuses to reset the default branch", () => {
    const devAsDefault = { ...dev, default: true };
    expect(() => assertSafeReset([production, devAsDefault], { source: "production", target: "dev" })).toThrow(
      /default branch/,
    );
  });

  it("refuses to reset a protected branch", () => {
    const protectedDev = { ...dev, protected: true };
    expect(() => assertSafeReset([production, protectedDev], { source: "production", target: "dev" })).toThrow(
      /protected/,
    );
  });

  it("refuses when the target's parent is not the source", () => {
    const orphanDev = { ...dev, parent_id: "br-other" };
    expect(() => assertSafeReset([production, orphanDev], { source: "production", target: "dev" })).toThrow(
      /parent/,
    );
  });

  it("refuses when a branch is missing or source and target are the same", () => {
    expect(() => assertSafeReset([production], { source: "production", target: "dev" })).toThrow(/not found/);
    expect(() => assertSafeReset([production, dev], { source: "dev", target: "dev" })).toThrow(/same branch/);
  });
});

describe("buildScrubStatements", () => {
  it("removes real subscriber data before adding fake rows", () => {
    const statements = buildScrubStatements(FAKE_SUBSCRIBERS);

    expect(statements.map((s) => s.text.split("\n")[0].trim())).toEqual([
      "DELETE FROM newsletter.auth_codes",
      "DELETE FROM newsletter.subscribers",
      "INSERT INTO newsletter.subscribers (email, status, source, first_name)",
    ]);
  });

  it("passes fake rows as query parameters", () => {
    const insert = buildScrubStatements(FAKE_SUBSCRIBERS)[2];

    expect(insert.values).toEqual(
      FAKE_SUBSCRIBERS.flatMap((s) => [s.email, s.status, s.source, s.firstName]),
    );
    for (const subscriber of FAKE_SUBSCRIBERS) {
      expect(insert.text).not.toContain(subscriber.email);
    }
  });
});

describe("FAKE_SUBSCRIBERS", () => {
  it("uses reserved example.com addresses and allowed statuses only", () => {
    expect(FAKE_SUBSCRIBERS.length).toBeGreaterThan(0);
    for (const subscriber of FAKE_SUBSCRIBERS) {
      expect(subscriber.email).toMatch(/@example\.com$/);
      expect(["active", "unsubscribed"]).toContain(subscriber.status);
    }
  });
});

describe("checkScrubResult", () => {
  it("passes when only fake subscribers and no login codes remain", () => {
    expect(() =>
      checkScrubResult({ auth_codes: 0, real_subscribers: 0, subscribers: FAKE_SUBSCRIBERS.length }),
    ).not.toThrow();
  });

  it("fails when any real subscriber or login code remains", () => {
    expect(() => checkScrubResult({ auth_codes: 0, real_subscribers: 1, subscribers: 4 })).toThrow(/real/);
    expect(() => checkScrubResult({ auth_codes: 2, real_subscribers: 0, subscribers: 3 })).toThrow(/login codes/);
  });
});
