import { describe, expect, it } from "vitest";

import { noIssueRequest } from "@/src/components/approval/no-issue-request";

describe("noIssueRequest", () => {
  it("marks a date as skipped with a JSON POST", () => {
    const [url, init] = noIssueRequest("2026-11-26", true);
    expect(url).toBe("/api/approval/skipped-dates");
    expect(init.method).toBe("POST");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init.body))).toEqual({ date: "2026-11-26" });
  });

  // The Origin check (#128) answers API writes without a JSON Content-Type with 415, DELETE included.
  it("undoes a skipped date with a DELETE that still says JSON", () => {
    const [url, init] = noIssueRequest("2026-11-26", false);
    expect(url).toBe("/api/approval/skipped-dates?date=2026-11-26");
    expect(init.method).toBe("DELETE");
    expect(init.headers).toEqual({ "content-type": "application/json" });
    expect(init.body).toBe("{}");
  });
});
