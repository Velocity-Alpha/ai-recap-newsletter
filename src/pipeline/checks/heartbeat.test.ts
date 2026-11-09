import { describe, expect, it, vi } from "vitest";

import { pingHeartbeat } from "@/src/pipeline/checks/heartbeat";

const URL_ = "https://hc-ping.example/abc";
const PROD = { APP_ENV: "production", HEALTHCHECKS_PING_URL: URL_ };

function fetchReturning(status: number) {
  return vi.fn(async () => new Response("OK", { status })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

describe("pingHeartbeat", () => {
  it("pings the check URL in production after a sent summary", async () => {
    const fetch = fetchReturning(200);

    await expect(pingHeartbeat({ env: PROD, fetch, ok: true, body: "summary: sent" })).resolves.toEqual({ status: "sent" });
    expect(fetch).toHaveBeenCalledWith(URL_, expect.objectContaining({ method: "POST", body: "summary: sent" }));
  });

  it("pings the fail URL when the summary did not reach the ops chat", async () => {
    const fetch = fetchReturning(200);

    await pingHeartbeat({ env: PROD, fetch, ok: false, body: "summary: failed" });
    expect(fetch).toHaveBeenCalledWith(`${URL_}/fail`, expect.anything());
  });

  it("never pings outside production", async () => {
    const fetch = fetchReturning(200);
    for (const APP_ENV of ["development", "preview", undefined]) {
      await expect(pingHeartbeat({ env: { ...PROD, APP_ENV }, fetch, ok: true, body: "" })).resolves.toEqual({
        status: "not_production",
      });
    }
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a missing URL as not configured", async () => {
    const fetch = fetchReturning(200);
    await expect(pingHeartbeat({ env: { APP_ENV: "production", HEALTHCHECKS_PING_URL: " " }, fetch, ok: true, body: "" })).resolves.toEqual({
      status: "not_configured",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports a failed ping without throwing or naming the URL", async () => {
    await expect(pingHeartbeat({ env: PROD, fetch: fetchReturning(503), ok: true, body: "" })).resolves.toEqual({
      status: "failed",
      reason: "HTTP 503",
    });

    const throwing = vi.fn(async () => {
      throw new Error("fetch failed");
    }) as unknown as typeof fetch;
    await expect(pingHeartbeat({ env: PROD, fetch: throwing, ok: true, body: "" })).resolves.toEqual({
      status: "failed",
      reason: "fetch failed",
    });
  });
});
