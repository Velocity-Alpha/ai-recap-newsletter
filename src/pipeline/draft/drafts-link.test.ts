import { describe, expect, it } from "vitest";

import { draftsLink } from "@/src/pipeline/draft/drafts-link";

const DATE = "2027-01-04";
const PRODUCTION_LINK = `https://airecap.news/approval/drafts?date=${DATE}`;

describe("draftsLink", () => {
  it("uses Netlify's URL in production", () => {
    expect(draftsLink(DATE, { APP_ENV: "production", URL: "https://airecap.news/", DEPLOY_PRIME_URL: "https://main--ai-recap.netlify.app" })).toBe(
      PRODUCTION_LINK,
    );
  });

  it("uses the deploy's own address on a preview", () => {
    expect(draftsLink(DATE, { APP_ENV: "preview", URL: "https://airecap.news", DEPLOY_PRIME_URL: "https://deploy-preview-9--ai-recap.netlify.app" })).toBe(
      `https://deploy-preview-9--ai-recap.netlify.app/approval/drafts?date=${DATE}`,
    );
  });

  it("falls back to the production site when no address is set", () => {
    expect(draftsLink(DATE, {})).toBe(PRODUCTION_LINK);
    expect(draftsLink(DATE, { APP_ENV: "production" })).toBe(PRODUCTION_LINK);
  });
});
