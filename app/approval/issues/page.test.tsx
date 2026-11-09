import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  cookieValue: undefined as string | undefined,
  listRecentIssues: vi.fn(),
  redirect: vi.fn((url: string) => {
    throw new Error(`NEXT_REDIRECT ${url}`);
  }),
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "approval_session" && mocks.cookieValue !== undefined ? { name, value: mocks.cookieValue } : undefined,
  }),
}));

vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

vi.mock("@/src/pipeline/publish/publish-store", () => ({
  createPrismaPublishStore: () => ({ listRecentIssues: mocks.listRecentIssues }),
}));

vi.mock("@/src/components/approval/MarkPublishedButton", () => ({
  default: () => <button type="button">Mark published</button>,
}));

import ApprovalIssuesPage from "@/app/approval/issues/page";
import { createApprovalSessionToken } from "@/src/server/approval-auth";

const config = { password: "approval-secret", sessionSecret: "test-session-secret" };

describe("approval issues page", () => {
  beforeEach(() => {
    vi.stubEnv("APPROVAL_PASSWORD", config.password);
    vi.stubEnv("SESSION_SECRET", config.sessionSecret);
    mocks.cookieValue = undefined;
    mocks.listRecentIssues.mockReset().mockResolvedValue([]);
    mocks.redirect.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("lists recent issues for a signed-in owner", async () => {
    mocks.cookieValue = await createApprovalSessionToken(config);

    const html = renderToStaticMarkup(await ApprovalIssuesPage());

    expect(mocks.redirect).not.toHaveBeenCalled();
    expect(mocks.listRecentIssues).toHaveBeenCalled();
    expect(html).toContain("Approval board");
  });

  it.each([
    ["no session cookie", undefined],
    ["a forged session cookie", `${Date.now() + 60_000}.${"0".repeat(32)}.${"0".repeat(64)}`],
  ])("sends a visitor with %s to the login page without reading issues", async (_label, cookieValue) => {
    mocks.cookieValue = cookieValue;

    await expect(ApprovalIssuesPage()).rejects.toThrow(/NEXT_REDIRECT/);

    expect(mocks.redirect).toHaveBeenCalledWith("/approval/login?redirect=%2Fapproval%2Fissues");
    expect(mocks.listRecentIssues).not.toHaveBeenCalled();
  });

  it("sends everyone to the login page when approval login is not configured", async () => {
    mocks.cookieValue = await createApprovalSessionToken(config);
    vi.stubEnv("SESSION_SECRET", "");

    await expect(ApprovalIssuesPage()).rejects.toThrow(/NEXT_REDIRECT/);
    expect(mocks.listRecentIssues).not.toHaveBeenCalled();
  });
});
