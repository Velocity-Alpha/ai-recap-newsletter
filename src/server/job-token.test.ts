import { describe, expect, it } from "vitest";

import { createCacheRefreshToken, isValidCacheRefreshToken } from "@/src/server/cache-refresh-auth";
import { createJobToken, isValidJobToken, JOB_TOKEN_TTL_MS } from "@/src/server/job-token";

const SECRET = "test-session-secret";
const NOW = new Date("2026-11-09T14:55:00.000Z");

describe("job tokens", () => {
  it("accepts a fresh token for the same purpose and rejects it once expired", () => {
    const token = createJobToken("ingest-stories", SECRET, NOW);
    expect(isValidJobToken("ingest-stories", token, SECRET, NOW)).toBe(true);
    expect(isValidJobToken("ingest-stories", token, SECRET, new Date(NOW.getTime() + JOB_TOKEN_TTL_MS + 1))).toBe(false);
    expect(isValidJobToken("ingest-stories", null, SECRET, NOW)).toBe(false);
  });

  it("never lets a token for one purpose work for another", () => {
    const ingest = createJobToken("ingest-stories", SECRET, NOW);
    expect(isValidCacheRefreshToken(ingest, SECRET, NOW)).toBe(false);
    expect(isValidJobToken("ingest-stories", createCacheRefreshToken(SECRET, NOW), SECRET, NOW)).toBe(false);
  });

  it("binds a token to its subject, when it has one", () => {
    const draft41 = createJobToken("draft-issue", SECRET, NOW, "41");
    expect(isValidJobToken("draft-issue", draft41, SECRET, NOW, "41")).toBe(true);
    expect(isValidJobToken("draft-issue", draft41, SECRET, NOW, "42")).toBe(false);
    expect(isValidJobToken("draft-issue", draft41, SECRET, NOW)).toBe(false);
    expect(isValidJobToken("draft-issue", createJobToken("draft-issue", SECRET, NOW), SECRET, NOW, "41")).toBe(false);
  });

  it("keeps cache refresh tokens identical to the job token for that purpose", () => {
    expect(createCacheRefreshToken(SECRET, NOW)).toBe(createJobToken("cache-refresh", SECRET, NOW));
  });
});
