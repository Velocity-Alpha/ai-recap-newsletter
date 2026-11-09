import { beforeEach, describe, expect, it, vi } from "vitest";

const runDraftJob = vi.hoisted(() => vi.fn());

vi.mock("@/src/pipeline/draft/run-draft", () => ({
  runDraftJob,
  describeDraftRun: () => "described",
}));

import draftIssueBackground from "@/netlify/functions/draft-issue-background.mjs";
import { createJobToken } from "@/src/server/job-token";

const SECRET = "s".repeat(32);

function post(token: string | null, body = JSON.stringify({ draftId: 41 })) {
  return new Request("https://airecap.news/.netlify/functions/draft-issue-background", {
    method: "POST",
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
  });
}

beforeEach(() => {
  vi.stubEnv("SESSION_SECRET", SECRET);
  runDraftJob.mockReset().mockResolvedValue({ status: "ready", draftId: 41, runId: "7", issue: "updated" });
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("draft-issue-background", () => {
  it("runs the draft named in a request with a valid job token", async () => {
    await draftIssueBackground(post(createJobToken("draft-issue", SECRET, new Date())));
    expect(runDraftJob).toHaveBeenCalledWith(41);
  });

  it("does nothing without a valid draft-issue token", async () => {
    await draftIssueBackground(post(null));
    await draftIssueBackground(post(createJobToken("ingest-stories", SECRET, new Date())));
    await draftIssueBackground(post("123.forged"));
    expect(runDraftJob).not.toHaveBeenCalled();
  });

  // Netlify retries a background function that throws. The draft is already marked, so a retry would only skip.
  it("never throws, even when the job does", async () => {
    runDraftJob.mockRejectedValue(new Error("database down"));
    await expect(draftIssueBackground(post(createJobToken("draft-issue", SECRET, new Date())))).resolves.toBeUndefined();
  });
});
