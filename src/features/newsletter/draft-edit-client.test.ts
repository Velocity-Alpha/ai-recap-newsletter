import { describe, expect, it, vi } from "vitest";

import { requestStage, requestTitleChange } from "@/src/features/newsletter/draft-edit-client";

function answer(status: number, body: unknown) {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

const offline = () => vi.fn<typeof fetch>(async () => Promise.reject(new TypeError("offline")));
const notJson = (status: number) => vi.fn<typeof fetch>(async () => new Response("<html>Bad gateway</html>", { status }));

const STAGED = {
  version: 3,
  serviceName: "Pretend Mail",
  serviceUrl: "https://preview.example.test/v3",
  mode: "sent",
  stagedAt: "2026-05-21T14:20:00.000Z",
};

describe("requestTitleChange", () => {
  it("sends the new title as a JSON PATCH to the draft, and returns the title as the server stored it", async () => {
    const fetcher = answer(200, { success: true, title: "Pretend Lab Ships a Planner" });

    await expect(requestTitleChange(41, "  Pretend Lab   Ships a Planner ", fetcher)).resolves.toBe("Pretend Lab Ships a Planner");
    expect(fetcher).toHaveBeenCalledTimes(1);
    // The Origin check (#128) answers a write that is not JSON with 415.
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "  Pretend Lab   Ships a Planner " }),
    });
  });

  it("throws the server's plain reason when the title was not changed", async () => {
    const taken = 'Another issue already uses the title "Pretend Lab Ships a Planner", and titles must be unique. Use a different title.';

    await expect(requestTitleChange(41, "Pretend Lab Ships a Planner", answer(409, { success: false, error: taken }))).rejects.toThrow(taken);
    await expect(requestTitleChange(41, "", answer(400, { error: "The title cannot be empty." }))).rejects.toThrow("The title cannot be empty.");
  });

  it("throws a plain fallback when the server gives no reason", async () => {
    await expect(requestTitleChange(41, "A title", answer(500, {}))).rejects.toThrow("Could not change the title.");
    await expect(requestTitleChange(41, "A title", answer(500, { error: "" }))).rejects.toThrow("Could not change the title.");
    await expect(requestTitleChange(41, "A title", notJson(502))).rejects.toThrow("Could not change the title.");
  });

  it("does not take a 200 without the stored title as a change", async () => {
    await expect(requestTitleChange(41, "A title", answer(200, { success: true }))).rejects.toThrow("Could not change the title.");
    await expect(requestTitleChange(41, "A title", answer(200, { title: 7 }))).rejects.toThrow("Could not change the title.");
  });

  it("does not take a failed answer that carries a title as a change", async () => {
    await expect(requestTitleChange(41, "A title", answer(409, { title: "A title", error: "The issue is already published." }))).rejects.toThrow(
      "The issue is already published.",
    );
  });

  it("says when the server could not be reached", async () => {
    await expect(requestTitleChange(41, "A title", offline())).rejects.toThrow("Could not reach the server. Try again.");
  });
});

describe("requestStage", () => {
  it("posts JSON to the draft's stage route, and returns the staged version", async () => {
    const fetcher = answer(200, { success: true, staged: STAGED });

    await expect(requestStage(41, false, fetcher)).resolves.toEqual({ kind: "staged", staged: STAGED });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmRepeat: false }),
    });
  });

  it("says the draft is already staged, with that version, so the page can ask before a repeat", async () => {
    const fetcher = answer(409, { success: false, code: "already_staged", version: 2, error: "v2 is already staged." });

    await expect(requestStage(41, false, fetcher)).resolves.toEqual({ kind: "already_staged", version: 2 });
  });

  it("sends the owner's yes to stage an unchanged draft again", async () => {
    const fetcher = answer(200, { success: true, staged: STAGED });

    await expect(requestStage(41, true, fetcher)).resolves.toMatchObject({ kind: "staged", staged: { version: 3 } });
    expect(fetcher).toHaveBeenCalledWith("/api/approval/drafts/41/stage", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmRepeat: true }),
    });
  });

  it("marks a staged version made outside production as recorded: nothing reached the service", async () => {
    const fetcher = answer(200, { staged: { ...STAGED, serviceUrl: null, mode: "recorded" } });

    await expect(requestStage(41, false, fetcher)).resolves.toEqual({
      kind: "staged",
      staged: { ...STAGED, serviceUrl: null, mode: "recorded" },
    });
  });

  it("fills in what the answer leaves out: no link, no time, and sent", async () => {
    const fetcher = answer(200, { staged: { version: 3, serviceName: "Pretend Mail" } });

    await expect(requestStage(41, false, fetcher)).resolves.toEqual({
      kind: "staged",
      staged: { version: 3, serviceName: "Pretend Mail", serviceUrl: null, mode: "sent", stagedAt: null },
    });
  });

  it("passes on only the fields the page uses", async () => {
    const fetcher = answer(200, { staged: { ...STAGED, serviceRef: "tpl_pretend", html: "<p>x</p>" } });

    await expect(requestStage(41, false, fetcher)).resolves.toEqual({ kind: "staged", staged: STAGED });
  });

  it("throws the server's plain reason for any other refusal, even a 409", async () => {
    await expect(requestStage(41, false, answer(409, { error: "The issue for 2026-05-21 is already published." }))).rejects.toThrow(
      "The issue for 2026-05-21 is already published.",
    );
    await expect(
      requestStage(41, false, answer(409, { code: "not_current", error: "This is not the newest draft for 2026-05-21. Reload the page." })),
    ).rejects.toThrow("Reload the page.");
    await expect(requestStage(41, false, answer(502, { error: "Staging failed: the distribution service answered HTTP 401." }))).rejects.toThrow(
      "Staging failed: the distribution service answered HTTP 401.",
    );
  });

  it("carries the HTTP status on the error, so the page can read the draft again after a refusal", async () => {
    await expect(requestStage(41, false, answer(409, { code: "not_current", error: "Reload the page." }))).rejects.toMatchObject({
      name: "DraftRequestError",
      status: 409,
    });
    await expect(requestStage(41, false, answer(502, { error: "Staging failed." }))).rejects.toMatchObject({ status: 502 });
    await expect(requestStage(41, false, offline())).rejects.toMatchObject({ name: "DraftRequestError", status: null });
    await expect(requestTitleChange(41, "A title", answer(409, { error: "The issue is already published." }))).rejects.toMatchObject({ status: 409 });
    await expect(requestTitleChange(41, "", answer(400, { error: "The title is empty." }))).rejects.toMatchObject({ status: 400 });
    await expect(requestTitleChange(41, "A title", offline())).rejects.toMatchObject({ status: null });
  });

  it("does not ask for a repeat unless the answer is a 409 that names the staged version", async () => {
    await expect(requestStage(41, false, answer(409, { code: "already_staged", error: "Already staged." }))).rejects.toThrow("Already staged.");
    await expect(requestStage(41, false, answer(500, { code: "already_staged", version: 2 }))).rejects.toThrow("Could not stage the draft.");
  });

  it("throws a plain fallback when the server gives no reason", async () => {
    await expect(requestStage(41, false, answer(500, {}))).rejects.toThrow("Could not stage the draft.");
    await expect(requestStage(41, false, answer(500, { error: "" }))).rejects.toThrow("Could not stage the draft.");
    await expect(requestStage(41, false, notJson(502))).rejects.toThrow("Could not stage the draft.");
  });

  it("does not take a 200 without a whole staged version as a staging", async () => {
    await expect(requestStage(41, false, answer(200, { success: true }))).rejects.toThrow("Could not stage the draft.");
    await expect(requestStage(41, false, answer(200, { staged: { serviceName: "Pretend Mail" } }))).rejects.toThrow("Could not stage the draft.");
    await expect(requestStage(41, false, answer(200, { staged: { version: 3 } }))).rejects.toThrow("Could not stage the draft.");
  });

  it("does not take a failed answer that carries a staged version as a staging", async () => {
    await expect(requestStage(41, false, answer(502, { staged: STAGED, error: "The staged version was not saved." }))).rejects.toThrow(
      "The staged version was not saved.",
    );
  });

  it("says when the server could not be reached", async () => {
    await expect(requestStage(41, false, offline())).rejects.toThrow("Could not reach the server. Try again.");
  });
});
