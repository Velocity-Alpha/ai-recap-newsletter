import { beforeEach, describe, expect, it, vi } from "vitest";

import { createApprovalSessionToken } from "@/src/server/approval-auth";

const repositoryFns = vi.hoisted(() => ({
  fetchLastPublishedIssueDateOnOrBefore: vi.fn(),
}));

vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

const outlineStore = vi.hoisted(() => ({ saveOutline: vi.fn() }));

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
    vi.clearAllMocks();
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(new Response(null, { status: 202 }));
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: false,
      issue: null,
    });
    outlineStore.saveOutline.mockResolvedValue({ id: BigInt(5), hash: "a".repeat(64) });
    draftStore.createDraft.mockResolvedValue({ draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" });
    draftStore.markDraftStartFailed.mockResolvedValue(true);
    storyChanges.applyStoryChanges.mockResolvedValue({ excluded: 1, queued: 2, edited: 1 });
    process.env.SESSION_SECRET = "s".repeat(32);
    process.env.APPROVAL_PASSWORD = "approval-secret";
  });

  function post(body: string, headers: Record<string, string> = {}) {
    return POST(
      new Request("http://localhost/api/newsletters/commit", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...headers },
        body,
      }),
    );
  }

  async function commit(body: unknown) {
    const token = await createApprovalSessionToken();
    const response = await post(JSON.stringify(body), { Cookie: `approval_session=${token}` });
    return { response, json: await response.json() };
  }

  function expectNothingStarted() {
    expect(outlineStore.saveOutline).not.toHaveBeenCalled();
    expect(storyChanges.applyStoryChanges).not.toHaveBeenCalled();
    expect(draftStore.createDraft).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  }

  it("saves the outline, applies the story changes, creates the draft, and starts its job", async () => {
    const { response, json } = await commit(BODY);

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      success: true,
      draft: { draftId: 41, issueId: 3, version: 2, issueDate: "2026-05-21" },
    });
    expect(outlineStore.saveOutline).toHaveBeenCalledWith(OUTLINE);
    expect(storyChanges.applyStoryChanges).toHaveBeenCalledWith(OUTLINE);
    expect(draftStore.createDraft).toHaveBeenCalledWith(BigInt(5), expect.anything());
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(BACKGROUND_URL);
    expect(JSON.parse(init.body)).toEqual({ draftId: 41 });
    expect(draftStore.markDraftStartFailed).not.toHaveBeenCalled();
  });

  it("accepts the body the approval board posts", async () => {
    const { response, json } = await commit(boardCommitPayload());

    expect(response.status).toBe(200);
    expect(json.success).toBe(true);
    expect(outlineStore.saveOutline).toHaveBeenCalledWith(
      expect.objectContaining({
        date: "2026-05-21",
        leadStoryId: 101,
        sections: [
          { key: "headlines", storyIds: [101, 102] },
          { key: "research", storyIds: [201] },
          { key: "tools", storyIds: [] },
          { key: "quickHits", storyIds: [401] },
        ],
      }),
    );
  });

  it("saves only the normalised YYYY-MM-DD date", async () => {
    const { response } = await commit({ ...BODY, date: "2026-05-21T23:30:00-05:00" });

    expect(response.status).toBe(200);
    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-05-21");
    expect(outlineStore.saveOutline).toHaveBeenCalledWith(OUTLINE);
  });

  it("rejects requests without an approval session", async () => {
    const response = await post(JSON.stringify(BODY));

    expect(response.status).toBe(401);
    expect((await response.json()).error).toBe("Unauthorized.");
    expectNothingStarted();
  });

  it("rejects a session past its server-side expiry", async () => {
    const dayAndAMinuteAgo = new Date(Date.now() - (24 * 60 + 1) * 60 * 1000);
    const token = await createApprovalSessionToken(undefined, dayAndAMinuteAgo);

    const response = await post(JSON.stringify(BODY), { Cookie: `approval_session=${token}` });

    expect(response.status).toBe(401);
    expectNothingStarted();
  });

  it("rejects every request when APPROVAL_PASSWORD is unset, outside production too", async () => {
    const token = await createApprovalSessionToken();
    delete process.env.APPROVAL_PASSWORD;

    for (const headers of [{}, { Cookie: `approval_session=${token}` }] as Record<string, string>[]) {
      expect((await post(JSON.stringify(BODY), headers)).status).toBe(401);
    }
    expectNothingStarted();
  });

  it("returns 400 when the body is not valid JSON", async () => {
    const token = await createApprovalSessionToken();

    const response = await post("{not json", { Cookie: `approval_session=${token}` });

    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Request body must be valid JSON.");
    expectNothingStarted();
  });

  it.each([undefined, "not-a-date", "05/21/2026", "2026-02-30", "2026-5-21", 20260521])(
    "rejects the date %j",
    async (date) => {
      const { response, json } = await commit({ ...BODY, date });

      expect(response.status).toBe(400);
      expect(json.success).toBe(false);
      expect(json.error).toContain("missing a valid date");
      expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).not.toHaveBeenCalled();
      expectNothingStarted();
    },
  );

  it("rejects an outline with no approved stories", async () => {
    const { response, json } = await commit({ date: "2026-05-21", approved_ids_by_section: { top_stories: [] } });

    expect(response.status).toBe(400);
    expect(json.error).toContain("no approved stories");
    expectNothingStarted();
  });

  it("refuses a published date before saving anything", async () => {
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-05-21",
      has_exact_match: true,
      issue: null,
    });

    const { response, json } = await commit(BODY);

    expect(response.status).toBe(409);
    expect(json.success).toBe(false);
    expect(json.error).toContain("already published");
    expectNothingStarted();
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
    errorLog.mockRestore();
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
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});

    const { response, json } = await commit(BODY);

    expect(draftStore.markDraftStartFailed).toHaveBeenCalledWith(41, "Starting the draft job failed with HTTP 500.", expect.any(Date));
    expect(response.status).toBe(502);
    expect(json).toMatchObject({
      success: false,
      error: "Starting the draft job failed with HTTP 500.",
      draft: { draftId: 41, version: 2 },
    });
    errorLog.mockRestore();
  });
});
