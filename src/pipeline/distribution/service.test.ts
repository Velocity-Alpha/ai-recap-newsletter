import { describe, expect, it, vi } from "vitest";

import { distributionServiceFromEnv } from "@/src/pipeline/distribution/service";
import type { SideEffectRecord } from "@/src/pipeline/side-effects";

const PRODUCTION_ENV = {
  APP_ENV: "production",
  GHL_PRIVATE_INTEGRATION_TOKEN: "pit-test-token-0000",
  GHL_LOCATION_ID: "loc_test",
  GHL_USER_ID: "user_test",
};

const EMAIL = { name: "2026-11-09 v3: Synthetic subject line", html: "<html><body><p>Synthetic</p></body></html>" };

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

describe("distributionServiceFromEnv", () => {
  it("gives the service's key for the database and its name for the owner", () => {
    const service = distributionServiceFromEnv({ APP_ENV: "development" });

    expect(service.key).toBe("ghl");
    expect(service.displayName).toBe("GHL");
  });

  it("creates a new email with the given name in production and returns its reference and link", async () => {
    const bodies: Array<Record<string, unknown>> = [];
    const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return String(input).endsWith("/emails/builder")
        ? json({ id: "tpl_new" })
        : json({ ok: true, previewUrl: "https://preview.example/tpl_new/index.html" });
    }) as unknown as typeof globalThis.fetch;

    const email = await distributionServiceFromEnv(PRODUCTION_ENV, { fetch }).createEmail(EMAIL);

    expect(email).toEqual({ ref: "tpl_new", url: "https://preview.example/tpl_new/index.html", mode: "sent" });
    expect(bodies[0]).toMatchObject({ title: EMAIL.name, html: EMAIL.html });
    expect(bodies[1]).toMatchObject({ templateId: "tpl_new", html: EMAIL.html });
  });

  it("gives a null link when the service returns none", async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) =>
      String(input).endsWith("/emails/builder") ? json({ id: "tpl_new" }) : json({ ok: true }),
    ) as unknown as typeof globalThis.fetch;

    const email = await distributionServiceFromEnv(PRODUCTION_ENV, { fetch }).createEmail(EMAIL);

    expect(email).toEqual({ ref: "tpl_new", url: null, mode: "sent" });
  });

  it("stops a running call when the caller's signal aborts", async () => {
    const caller = new AbortController();
    const fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("The call was stopped.")));
        }),
    ) as unknown as typeof globalThis.fetch;

    const email = distributionServiceFromEnv(PRODUCTION_ENV, { fetch }).createEmail({ ...EMAIL, signal: caller.signal });
    caller.abort();

    await expect(email).rejects.toThrow("The call was stopped.");
  });

  it.each(["preview", "development", undefined])("records the calls and sends nothing when APP_ENV is %j", async (appEnv) => {
    const fetch = vi.fn() as unknown as typeof globalThis.fetch;
    const records: SideEffectRecord[] = [];

    const email = await distributionServiceFromEnv({ ...PRODUCTION_ENV, APP_ENV: appEnv }, { fetch, record: (entry) => void records.push(entry) }).createEmail(EMAIL);

    expect(fetch).not.toHaveBeenCalled();
    expect(email).toEqual({ ref: "dry-run-2026-11-09-v3", url: null, mode: "recorded" });
    expect(records.map((entry) => [entry.target, entry.action])).toEqual([
      ["distribution", "createTemplate"],
      ["distribution", "setTemplateHtml"],
    ]);
  });
});
