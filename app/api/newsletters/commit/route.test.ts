import jwt from "jsonwebtoken";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const repositoryFns = vi.hoisted(() => ({
  fetchLastPublishedIssueDateOnOrBefore: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

const outlineStore = vi.hoisted(() => ({
  readDraftOwner: vi.fn(),
  saveOutline: vi.fn(),
  markOutlineForwarded: vi.fn(),
}));

vi.mock("@/src/pipeline/draft/outline-store", () => outlineStore);

const draftStore = vi.hoisted(() => ({
  createDraft: vi.fn(),
  markDraftStartFailed: vi.fn(),
}));

vi.mock("@/src/pipeline/draft/draft-store", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/src/pipeline/draft/draft-store")>()),
  ...draftStore,
}));

const storyChanges = vi.hoisted(() => ({ applyStoryChanges: vi.fn() }));

vi.mock("@/src/pipeline/draft/story-changes", () => storyChanges);

import { POST } from "@/app/api/newsletters/commit/route";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";

type BoardStory = { id: number; headline: string; summary: string };
type BoardSlot = { story: BoardStory; status: "selected" | "fill-in" };
type BoardSection = { key: string; label: string; max: number; stories: BoardSlot[] };

function boardCandidate(id: number, category: string) {
  return {
    id,
    guid: `guid-${id}`,
    day: "2026-05-20",
    headline: `Synthetic headline ${id}`,
    summary: `Synthetic summary ${id}`,
    story_details: `Synthetic details ${id}`,
    category,
    source: "example.com",
    url: `https://example.com/story-${id}`,
    importance_score: 7,
    keyword_score: 2,
    combined_score: 9,
  };
}

/**
 * The body the approval board posts on commit, built the way `commitPayload` in
 * src/components/approval/ApprovalBoard.tsx builds it (same keys, same order), from synthetic stories.
 */
function boardCommitPayload() {
  const story = (id: number): BoardStory => ({
    id,
    headline: `Synthetic headline ${id}`,
    summary: `Synthetic summary ${id}`,
  });
  const sections: BoardSection[] = [
    {
      key: "headlines",
      label: "Headlines",
      max: 2,
      stories: [
        { story: story(101), status: "selected" },
        { story: story(102), status: "selected" },
        { story: story(103), status: "fill-in" },
      ],
    },
    { key: "research", label: "Research", max: 1, stories: [{ story: story(201), status: "selected" }] },
    { key: "tools", label: "Tools", max: 1, stories: [{ story: story(301), status: "fill-in" }] },
    { key: "quickHits", label: "Quick Hits", max: 3, stories: [{ story: story(401), status: "selected" }] },
  ];
  const candidateMap: Record<string, ReturnType<typeof boardCandidate>> = {
    "101": boardCandidate(101, "Industry"),
    "102": boardCandidate(102, "Industry"),
    "103": boardCandidate(103, "Policy"),
    "201": boardCandidate(201, "Research"),
    "301": boardCandidate(301, "Tools"),
    "401": boardCandidate(401, "Industry"),
  };
  const notesOverrides: Record<number, string> = { 101: "Lead with the numbers." };
  const urlOverrides: Record<number, string> = { 201: "https://example.com/paper-201" };
  const excludeState: Record<number, { excluded: boolean; reason: string }> = {
    103: { excluded: true, reason: "Duplicate of 101" },
  };
  const headlineStoryId = 101;

  const toOption = (slot: BoardSlot) => ({
    id: slot.story.id,
    headline: slot.story.headline,
    summary: slot.story.summary,
    note: notesOverrides[slot.story.id] ?? "",
  });
  const candidateSections = sections.map((section) => ({
    key: section.key,
    label: section.label,
    max: section.max,
    selected: section.stories.filter((slot) => slot.status === "selected").map(toOption),
    fill_ins: section.stories.filter((slot) => slot.status === "fill-in").map(toOption),
  }));
  const allVisibleStories = sections.flatMap((section) =>
    section.stories.map((slot) => ({
      slot,
      section,
      candidate: candidateMap[String(slot.story.id)],
      exclude: excludeState[slot.story.id],
    })),
  );
  const selectedStoryIds = candidateSections.flatMap((section) => section.selected.map((s) => s.id));

  return {
    date: "2026-05-21",
    approved_ids_by_section: Object.fromEntries(
      candidateSections.map((section) => [section.key, section.selected.map((s) => s.id)]),
    ),
    excluded_stories: allVisibleStories
      .filter(({ exclude }) => exclude?.excluded)
      .map(({ slot, section, exclude }) => ({
        id: slot.story.id,
        headline: slot.story.headline,
        summary: slot.story.summary,
        note: notesOverrides[slot.story.id] ?? "",
        reason: exclude?.reason ?? "",
        newsletter_category: section.key,
      })),
    newsletter_headline: headlineStoryId,
    candidate_sections: candidateSections,
    candidate_map: Object.fromEntries(
      allVisibleStories.map(({ slot, candidate }) => [
        String(slot.story.id),
        {
          id: candidate.id,
          guid: candidate.guid ?? null,
          day: candidate.day ?? null,
          headline: slot.story.headline,
          url: urlOverrides[slot.story.id] ?? candidate.url ?? null,
          summary: slot.story.summary,
          note: notesOverrides[slot.story.id] ?? "",
          category: candidate.category ?? null,
          source: candidate.source ?? null,
          story_details: candidate.story_details ?? null,
          importance_score: candidate.importance_score ?? null,
          keyword_score: candidate.keyword_score,
          combined_score: candidate.combined_score,
        },
      ]),
    ),
    selected_story_ids: selectedStoryIds,
    stories: allVisibleStories.map(({ slot, section, candidate }) => ({
      id: candidate.id,
      guid: candidate.guid ?? null,
      day: candidate.day ?? null,
      headline: slot.story.headline,
      url: urlOverrides[slot.story.id] ?? candidate.url ?? null,
      summary: slot.story.summary,
      note: notesOverrides[slot.story.id] ?? "",
      source: candidate.source ?? null,
      story_details: candidate.story_details ?? null,
      importance_score: candidate.importance_score ?? null,
      keyword_score: candidate.keyword_score,
      combined_score: candidate.combined_score,
      source_category: candidate.category ?? null,
      newsletter_category: section.key,
    })),
    queue_update_count: selectedStoryIds.length,
  };
}

describe("POST /api/newsletters/commit", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: false,
      issue: null,
    });
    outlineStore.readDraftOwner.mockResolvedValue("n8n");
    outlineStore.saveOutline.mockResolvedValue({ id: BigInt(5), hash: "a".repeat(64) });
    outlineStore.markOutlineForwarded.mockResolvedValue(undefined);
    draftStore.createDraft.mockResolvedValue({ draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" });
    draftStore.markDraftStartFailed.mockResolvedValue(true);
    storyChanges.applyStoryChanges.mockResolvedValue({ excluded: 1, queued: 2, edited: 1 });
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.APPROVAL_PASSWORD = "approval-secret";
    process.env.N8N_WEBHOOK_JWT_SECRET = "n8n-webhook-jwt-secret";
    process.env.APP_ENV = "production";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL =
      "https://n8n.velocityalpha.com/webhook/story/approval";
  });

  afterEach(() => {
    delete process.env.APP_ENV;
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
  });

  async function commit(body: unknown) {
    const token = await createApprovalSessionToken("approval-secret");
    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: `approval_session=${token}` },
        body: JSON.stringify(body),
      }),
    );
    return { response, json: await response.json() };
  }

  function webhookAccepts() {
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: vi.fn().mockResolvedValue({ accepted: true }) });
  }

  it("uses the production n8n webhook by default in production", async () => {
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
    webhookAccepts();

    const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith("https://n8n.velocityalpha.com/webhook/story/approval", expect.anything());
  });

  it.each(["preview", "development"])("refuses to commit in %s when no webhook is set", async (appEnv) => {
    process.env.APP_ENV = appEnv;
    delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;

    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(json.error).toContain("OUTLINE_COMMIT_WEBHOOK_URL");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses the production webhook outside production", async () => {
    process.env.APP_ENV = "preview";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL = "https://n8n.velocityalpha.com/webhook/story/approval/";

    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(503);
    expect(json.error).toContain("production n8n webhook");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards to a non-production webhook outside production", async () => {
    process.env.APP_ENV = "preview";
    process.env.OUTLINE_COMMIT_WEBHOOK_URL = "https://n8n.velocityalpha.com/webhook-test/story/approval";
    webhookAccepts();

    const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook-test/story/approval",
      expect.anything(),
    );
  });

  it.each([
    ["no webhook", undefined],
    ["the production webhook", "https://n8n.velocityalpha.com/webhook/story/approval"],
  ])("refuses to commit when APP_ENV is unset and %s is set", async (_label, webhookUrl) => {
    delete process.env.APP_ENV;
    if (webhookUrl) process.env.OUTLINE_COMMIT_WEBHOOK_URL = webhookUrl;
    else delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;

    const { response, json } = await commit(boardCommitPayload());

    expect(response.status).toBe(503);
    expect(json.success).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("forwards a full board commit to n8n byte for byte, signed with the webhook secret", async () => {
    webhookAccepts();
    const payload = boardCommitPayload();

    const { response } = await commit(payload);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://n8n.velocityalpha.com/webhook/story/approval");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // The board already sends YYYY-MM-DD, so n8n must get exactly what the board sent.
    expect(init.body).toBe(JSON.stringify(payload));

    const authorization: string = init.headers.Authorization;
    expect(authorization.startsWith("Bearer ")).toBe(true);
    const secret = process.env.N8N_WEBHOOK_JWT_SECRET ?? "";
    const claims = jwt.verify(authorization.slice("Bearer ".length), secret, {
      algorithms: ["HS256"],
    }) as jwt.JwtPayload;
    expect(claims).toMatchObject({
      scope: "story-approval",
      payloadType: "object",
      issuedFor: "n8n-story-approval-webhook",
    });
    expect(Number(claims.exp) - Number(claims.iat)).toBe(3600);
  });

  it("forwards only the normalised YYYY-MM-DD date", async () => {
    webhookAccepts();

    await commit({ date: "2026-05-21T23:30:00-05:00", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] });

    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [1] },
      selected_story_ids: [1],
    });
  });

  it.each(["05/21/2026", "2026-02-30", "2026-5-21", 20260521])("rejects the date %j", async (date) => {
    const { response, json } = await commit({ date, selected_story_ids: [1] });

    expect(response.status).toBe(400);
    expect(json.error).toContain("missing a valid date");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects requests without an approval session", async () => {
    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(401);
    expect(json.error).toBe("Unauthorized.");
  });

  it("commits authenticated outline payloads to the configured webhook", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: vi.fn().mockResolvedValue({ accepted: true }),
    });

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");

    expect(fetchMock).toHaveBeenCalledWith(
      "https://n8n.velocityalpha.com/webhook/story/approval",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
  });

  it("blocks commit when an issue already exists for the same date", async () => {
    const token = await createApprovalSessionToken("approval-secret");
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: true,
      issue: {
        id: "42",
        slug: "existing-issue",
        title: "Already Published",
        issue_date: "2026-05-21T00:00:00.000Z",
        published_at: "2026-05-21T13:00:00.000Z",
      },
    });

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain("already published");
  });

  it("returns 400 when commit payload is missing a date", async () => {
    const token = await createApprovalSessionToken("approval-secret");

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("missing a valid date");
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 400 when commit payload contains an invalid date", async () => {
    const token = await createApprovalSessionToken("approval-secret");

    const response = await POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Cookie: `approval_session=${token}`,
        },
        body: JSON.stringify({ date: "not-a-date", selected_story_ids: [1] }),
      })
    );
    const json = await response.json();

    expect(response.status).toBe(400);
    expect(json.success).toBe(false);
    expect(json.error).toContain("missing a valid date");
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("saves the normalised outline with draft owner n8n before forwarding", async () => {
    webhookAccepts();
    const body = {
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [3, 1] },
      newsletter_headline: 3,
      excluded_stories: [{ id: 9, reason: "off topic", newsletter_category: "top_stories", headline: "x" }],
      stories: [{ id: 3, url: "https://example.com/edited", note: "n", newsletter_category: "top_stories" }],
      candidate_map: { "3": { id: 3 } },
    };

    const { response } = await commit(body);

    expect(response.status).toBe(200);
    expect(outlineStore.saveOutline).toHaveBeenCalledWith(
      {
        date: "2026-05-21",
        sections: [{ key: "top_stories", storyIds: [3, 1] }],
        leadStoryId: 3,
        stories: [{ id: 3, section: "top_stories", url: "https://example.com/edited", note: "n" }],
        excluded: [{ id: 9, section: "top_stories", reason: "off topic" }],
      },
      "n8n",
    );
    expect(outlineStore.saveOutline.mock.invocationCallOrder[0]).toBeLessThan(fetchMock.mock.invocationCallOrder[0]);
    // n8n still receives the board's body (with the normalised date).
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual(body);
  });

  it("still forwards to n8n when saving the outline fails in n8n mode, and logs the failure", async () => {
    webhookAccepts();
    outlineStore.saveOutline.mockRejectedValue(new Error('relation "approval_outlines" does not exist'));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const payload = boardCommitPayload();

    const { response, json } = await commit(payload);

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][1].body).toBe(JSON.stringify(payload));
    expect(errorLog).toHaveBeenCalledWith(
      "[observability] request.error",
      expect.objectContaining({
        route: "api.newsletters.commit",
        date: "2026-05-21",
        error: expect.objectContaining({ message: 'relation "approval_outlines" does not exist' }),
      }),
    );
    expect(outlineStore.markOutlineForwarded).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("stops an n8n-mode commit before saving anything when N8N_WEBHOOK_JWT_SECRET is unset", async () => {
    // A failed save is soft in n8n mode (above), but a missing secret is not: n8n could never accept the commit.
    delete process.env.N8N_WEBHOOK_JWT_SECRET;
    webhookAccepts();
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { response, json } = await commit(boardCommitPayload());

    expect(response.status).toBe(500);
    expect(json).toMatchObject({ success: false, error: expect.stringContaining("N8N_WEBHOOK_JWT_SECRET") });
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(storyChanges.applyStoryChanges).not.toHaveBeenCalled();
    expect(draftStore.createDraft).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    errorLog.mockRestore();
  });

  it("marks the saved outline forwarded after n8n answers 2xx", async () => {
    webhookAccepts();

    const { response } = await commit(boardCommitPayload());

    expect(response.status).toBe(200);
    expect(outlineStore.markOutlineForwarded).toHaveBeenCalledWith(BigInt(5));
    expect(fetchMock.mock.invocationCallOrder[0]).toBeLessThan(
      outlineStore.markOutlineForwarded.mock.invocationCallOrder[0],
    );
  });

  it("does not mark the outline forwarded when n8n fails", async () => {
    fetchMock.mockResolvedValue({ ok: false, status: 500, text: vi.fn().mockResolvedValue("boom") });

    const { response } = await commit(boardCommitPayload());

    expect(response.status).toBe(500);
    expect(outlineStore.markOutlineForwarded).not.toHaveBeenCalled();
  });

  it("still reports success when n8n accepted but marking the outline forwarded fails", async () => {
    // n8n is already drafting. A 500 here would invite a second commit and a second draft.
    webhookAccepts();
    outlineStore.markOutlineForwarded.mockRejectedValue(new Error("db down"));
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { response, json } = await commit(boardCommitPayload());

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(errorLog).toHaveBeenCalledWith(
      "[observability] request.error",
      expect.objectContaining({ outlineId: "5", error: expect.objectContaining({ message: "db down" }) }),
    );
    errorLog.mockRestore();
  });

  it("leaves drafts and stories to n8n while draft.owner is n8n", async () => {
    webhookAccepts();

    await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [1] }, excluded_stories: [{ id: 9 }] });

    expect(storyChanges.applyStoryChanges).not.toHaveBeenCalled();
    expect(draftStore.createDraft).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("https://n8n.velocityalpha.com/webhook/story/approval");
  });

  describe("while draft.owner is native", () => {
    const BACKGROUND_URL = "http://localhost/.netlify/functions/draft-issue-background";
    const BODY = {
      date: "2026-05-21",
      approved_ids_by_section: { top_stories: [3, 1] },
      newsletter_headline: 3,
      excluded_stories: [{ id: 9, reason: "off topic", newsletter_category: "top_stories" }],
      stories: [{ id: 3, url: "https://example.com/edited", note: "n", newsletter_category: "top_stories" }],
    };
    const OUTLINE = {
      date: "2026-05-21",
      sections: [{ key: "top_stories", storyIds: [3, 1] }],
      leadStoryId: 3,
      stories: [{ id: 3, section: "top_stories", url: "https://example.com/edited", note: "n" }],
      excluded: [{ id: 9, section: "top_stories", reason: "off topic" }],
    };

    beforeEach(() => {
      outlineStore.readDraftOwner.mockResolvedValue("native");
      fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    });

    it("saves the outline as native, applies the story changes, creates the draft, and starts its job", async () => {
      const { response, json } = await commit(BODY);

      expect(response.status).toBe(200);
      expect(json).toMatchObject({
        success: true,
        owner: "native",
        draft: { draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" },
      });
      expect(outlineStore.saveOutline).toHaveBeenCalledWith(OUTLINE, "native");
      expect(storyChanges.applyStoryChanges).toHaveBeenCalledWith(OUTLINE);
      expect(draftStore.createDraft).toHaveBeenCalledWith(BigInt(5), expect.anything());
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0];
      expect(url).toBe(BACKGROUND_URL);
      expect(JSON.parse(init.body)).toEqual({ draftId: 41 });
      expect(draftStore.markDraftStartFailed).not.toHaveBeenCalled();
      // forwarded_at is n8n's acceptance only; issue_drafts tracks the native job.
      expect(outlineStore.markOutlineForwarded).not.toHaveBeenCalled();
    });

    it("returns 500 and starts nothing when the outline cannot be saved", async () => {
      outlineStore.saveOutline.mockRejectedValue(new Error('relation "approval_outlines" does not exist'));
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

      const { response, json } = await commit(BODY);

      expect(response.status).toBe(500);
      expect(json).toMatchObject({ success: false, error: 'relation "approval_outlines" does not exist' });
      expect(storyChanges.applyStoryChanges).not.toHaveBeenCalled();
      expect(draftStore.createDraft).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
      expect(outlineStore.markOutlineForwarded).not.toHaveBeenCalled();
      errorLog.mockRestore();
    });

    it("never calls n8n, and needs neither its secret nor its webhook", async () => {
      process.env.APP_ENV = "preview";
      delete process.env.OUTLINE_COMMIT_WEBHOOK_URL;
      delete process.env.N8N_WEBHOOK_JWT_SECRET;

      const { response } = await commit(BODY);

      expect(response.status).toBe(200);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([BACKGROUND_URL]);
    });

    it("refuses a published date before saving anything", async () => {
      repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({ target_date: "2026-05-21", has_exact_match: true, issue: null });

      const { response, json } = await commit(BODY);

      expect(response.status).toBe(409);
      expect(json.error).toContain("already published");
      expect(outlineStore.saveOutline).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("refuses with 409 when the issue was published while committing", async () => {
      draftStore.createDraft.mockRejectedValue(new IssuePublishedError(3, "2026-05-21"));

      const { response, json } = await commit(BODY);

      expect(response.status).toBe(409);
      expect(json).toMatchObject({
        success: false,
        error: "The issue for 2026-05-21 (id 3) is already published. Drafting stopped.",
      });
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it("marks the draft failed and returns it when its job does not start", async () => {
      fetchMock.mockResolvedValue(new Response("down", { status: 500 }));

      const { response, json } = await commit(BODY);

      expect(draftStore.markDraftStartFailed).toHaveBeenCalledWith(41, "Starting the draft job failed with HTTP 500.", expect.any(Date));
      expect(response.status).toBe(502);
      expect(json).toMatchObject({
        success: false,
        owner: "native",
        error: "Starting the draft job failed with HTTP 500.",
        draft: { draftId: 41, version: 2 },
      });
    });

    it("rejects an outline with no approved stories", async () => {
      const { response } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

      expect(response.status).toBe(400);
      expect(outlineStore.saveOutline).not.toHaveBeenCalled();
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  it("rejects an outline with no approved stories", async () => {
    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

    expect(response.status).toBe(400);
    expect(json.error).toContain("no approved stories");
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
