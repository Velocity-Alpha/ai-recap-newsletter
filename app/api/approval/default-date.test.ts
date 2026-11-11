import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The board's routes without a usable ?date= must use today in New York, like the board page.
// Auth is mocked here so these tests do not depend on how sessions are signed.
const authFns = vi.hoisted(() => ({ hasValidApprovalSession: vi.fn() }));
const curationFns = vi.hoisted(() => ({
  createOutlineCandidateStories: vi.fn(),
  createApprovalOutlineData: vi.fn(),
}));
const leadPickFns = vi.hoisted(() => ({ submitLeadPick: vi.fn() }));
const repositoryFns = vi.hoisted(() => ({ fetchLastPublishedIssueDateOnOrBefore: vi.fn() }));

vi.mock("@/src/server/approval-auth", () => authFns);
vi.mock("@/src/features/newsletter/curation.service", () => curationFns);
vi.mock("@/src/features/newsletter/openai-lead-pick", () => leadPickFns);
vi.mock("@/src/features/newsletter/repository", () => repositoryFns);

import { GET as getOutline } from "@/app/api/approval/outline/route";
import { GET as getLegacyOutline } from "@/app/api/newsletters/outline/route";
import { GET as getPublishStatus } from "@/app/api/newsletters/publish-status/route";

const OUTLINE = { reference_stories: [], candidate_sections: [], candidate_map: {}, selected_story_ids: [], repeats_removed: [] };
// Sunday 2026-11-08 23:30 in New York; UTC is already Monday.
const SUNDAY_NIGHT_NEW_YORK = new Date("2026-11-09T04:30:00.000Z");
const SUNDAY = new Date("2026-11-08");

describe("approval routes without a date", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY_NIGHT_NEW_YORK);
    authFns.hasValidApprovalSession.mockResolvedValue(true);
    curationFns.createOutlineCandidateStories.mockResolvedValue({
      outline: OUTLINE,
      referencedStories: [],
      rankedCandidates: [],
    });
    curationFns.createApprovalOutlineData.mockResolvedValue(OUTLINE);
    repositoryFns.fetchLastPublishedIssueDateOnOrBefore.mockResolvedValue({
      target_date: "2026-11-08",
      has_exact_match: false,
      issue: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("builds the outline for today in New York", async () => {
    await getOutline(new Request("http://localhost/api/approval/outline"));
    await getOutline(new Request("http://localhost/api/approval/outline?date=not-a-date"));

    expect(curationFns.createOutlineCandidateStories).toHaveBeenNthCalledWith(1, SUNDAY, {
      reuseDraftDates: [],
    });
    expect(curationFns.createOutlineCandidateStories).toHaveBeenNthCalledWith(2, SUNDAY, {
      reuseDraftDates: [],
    });
  });

  it("builds the legacy outline for today in New York", async () => {
    await getLegacyOutline(new Request("http://localhost/api/newsletters/outline"));

    expect(curationFns.createApprovalOutlineData).toHaveBeenCalledWith(SUNDAY);
  });

  it("checks the publish status for today in New York", async () => {
    await getPublishStatus(new Request("http://localhost/api/newsletters/publish-status"));

    expect(repositoryFns.fetchLastPublishedIssueDateOnOrBefore).toHaveBeenCalledWith("2026-11-08");
  });

  it("keeps a valid date", async () => {
    await getOutline(new Request("http://localhost/api/approval/outline?date=2026-11-06"));

    expect(curationFns.createOutlineCandidateStories).toHaveBeenCalledWith(
      new Date("2026-11-06"),
      { reuseDraftDates: [] }
    );
  });
});
