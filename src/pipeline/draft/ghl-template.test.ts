import { describe, expect, it, vi } from "vitest";

import {
  createDraftTemplate,
  draftTemplateName,
  GHL_API_VERSION,
  type DraftTemplateInput,
} from "@/src/pipeline/draft/ghl-template";
import type { SideEffectRecord } from "@/src/pipeline/side-effects";

const TOKEN = "pit-test-token-0000";

const PRODUCTION_ENV = {
  APP_ENV: "production",
  GHL_PRIVATE_INTEGRATION_TOKEN: TOKEN,
  GHL_LOCATION_ID: "loc_test",
  GHL_USER_ID: "user_test",
};

const INPUT: DraftTemplateInput = {
  issueDate: "2026-11-09",
  version: 2,
  subject: "Synthetic subject line",
  html: "<html><body><p>Synthetic draft</p></body></html>",
};

type Call = { url: string; init: RequestInit };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/** A fake GHL that answers the two builder POSTs the way the real API did for n8n. */
function fakeGhl(overrides: { create?: () => Response; setHtml?: () => Response } = {}) {
  const calls: Call[] = [];
  const fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init: init ?? {} });
    if (url.endsWith("/emails/builder")) {
      return overrides.create?.() ?? json({ redirect: "tpl_new", id: "tpl_new", status: "ok", traceId: "t1" });
    }
    if (url.endsWith("/emails/builder/data")) {
      return (
        overrides.setHtml?.() ??
        json({ ok: true, previewUrl: "https://preview.example/tpl_new/index.html", id: "tpl_new", versionId: "v1" })
      );
    }
    return json({ message: "unexpected" }, 404);
  });
  return { fetch: fetch as unknown as typeof globalThis.fetch, calls };
}

function body(call: Call): Record<string, unknown> {
  return JSON.parse(String(call.init.body)) as Record<string, unknown>;
}

function headers(call: Call): Record<string, string> {
  return Object.fromEntries(new Headers(call.init.headers).entries());
}

describe("draftTemplateName", () => {
  it("is the date, the version and the subject", () => {
    expect(draftTemplateName(INPUT)).toBe("2026-11-09 v2: Synthetic subject line");
  });

  it("trims the subject and folds line breaks", () => {
    expect(draftTemplateName({ ...INPUT, version: 1, subject: "  A long\n subject  " })).toBe("2026-11-09 v1: A long subject");
  });

  it("refuses a bad date, version or empty subject", () => {
    expect(() => draftTemplateName({ ...INPUT, issueDate: "2026-11-9" })).toThrow(/YYYY-MM-DD/);
    expect(() => draftTemplateName({ ...INPUT, version: 0 })).toThrow(/version/);
    expect(() => draftTemplateName({ ...INPUT, version: 1.5 })).toThrow(/version/);
    expect(() => draftTemplateName({ ...INPUT, subject: "   " })).toThrow(/subject/);
  });
});

describe("createDraftTemplate in production", () => {
  it("creates the template, then sets its HTML, with GHL's headers and n8n's bodies", async () => {
    const ghl = fakeGhl();

    const result = await createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch });

    expect(result).toEqual({
      templateId: "tpl_new",
      previewUrl: "https://preview.example/tpl_new/index.html",
      mode: "sent",
    });
    expect(ghl.calls).toHaveLength(2);
    const [create, setHtml] = ghl.calls;

    expect(create.url).toBe("https://services.leadconnectorhq.com/emails/builder");
    expect(create.init.method).toBe("POST");
    expect(body(create)).toEqual({
      locationId: "loc_test",
      title: "2026-11-09 v2: Synthetic subject line",
      type: "html",
      builderVersion: "2",
      html: INPUT.html,
    });

    expect(setHtml.url).toBe("https://services.leadconnectorhq.com/emails/builder/data");
    expect(setHtml.init.method).toBe("POST");
    expect(body(setHtml)).toEqual({
      locationId: "loc_test",
      templateId: "tpl_new",
      updatedBy: "user_test",
      editorType: "html",
      html: INPUT.html,
    });

    for (const call of ghl.calls) {
      expect(headers(call)).toEqual({
        accept: "application/json",
        authorization: `Bearer ${TOKEN}`,
        "content-type": "application/json",
        version: GHL_API_VERSION,
      });
    }
    expect(GHL_API_VERSION).toBe("2021-07-28");
  });

  it("never edits or deletes another template: two POSTs, the second only for the new id", async () => {
    const ghl = fakeGhl({ create: () => json({ id: "tpl_fresh", status: "ok" }) });

    await createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch });

    expect(ghl.calls.map((call) => [call.init.method, new URL(call.url).pathname])).toEqual([
      ["POST", "/emails/builder"],
      ["POST", "/emails/builder/data"],
    ]);
    expect(body(ghl.calls[1]).templateId).toBe("tpl_fresh");
  });

  it("leaves the preview URL out when GHL does not return one", async () => {
    const ghl = fakeGhl({ setHtml: () => json({ ok: true, id: "tpl_new" }) });

    const result = await createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch });

    expect(result).toEqual({ templateId: "tpl_new", mode: "sent" });
  });

  it.each(["GHL_PRIVATE_INTEGRATION_TOKEN", "GHL_LOCATION_ID", "GHL_USER_ID"])(
    "fails before any call when %s is missing",
    async (name) => {
      const ghl = fakeGhl();
      const env = { ...PRODUCTION_ENV, [name]: " " };

      await expect(createDraftTemplate(INPUT, { env, fetch: ghl.fetch })).rejects.toThrow(`Missing setting: ${name}.`);
      expect(ghl.calls).toHaveLength(0);
    },
  );

  it("names the step and the status when creating fails, without the token", async () => {
    const ghl = fakeGhl({ create: () => json({ statusCode: 401, message: `Invalid token ${TOKEN}` }, 401) });

    const failure = createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch });

    await expect(failure).rejects.toThrow(/create template \(POST \/emails\/builder\) failed with HTTP 401/);
    await expect(failure).rejects.not.toThrow(TOKEN);
    expect(ghl.calls).toHaveLength(1);
  });

  it("names the step, the status and the new template id when setting the HTML fails", async () => {
    const ghl = fakeGhl({ setHtml: () => json({ message: "Bad request" }, 422) });

    const error = await createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toMatch(/set template HTML \(POST \/emails\/builder\/data\) failed with HTTP 422/);
    expect((error as Error).message).toContain("tpl_new");
    expect((error as Error).message).not.toContain(TOKEN);
    expect(error).toMatchObject({ step: "setTemplateHtml", status: 422, templateId: "tpl_new" });
  });

  it("fails when GHL answers without a template id", async () => {
    const ghl = fakeGhl({ create: () => json({ status: "ok" }) });

    await expect(createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch: ghl.fetch })).rejects.toThrow(
      /create template .* returned no template id/,
    );
    expect(ghl.calls).toHaveLength(1);
  });

  it("names the step when the network fails, without the token", async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;

    const failure = createDraftTemplate(INPUT, { env: PRODUCTION_ENV, fetch });

    await expect(failure).rejects.toThrow(/create template \(POST \/emails\/builder\) failed: fetch failed/);
    await expect(failure).rejects.not.toThrow(TOKEN);
  });
});

describe("createDraftTemplate outside production", () => {
  it.each(["preview", "development", undefined])("records both calls and sends nothing when APP_ENV is %j", async (appEnv) => {
    const ghl = fakeGhl();
    const records: SideEffectRecord[] = [];

    const result = await createDraftTemplate(INPUT, {
      env: { ...PRODUCTION_ENV, APP_ENV: appEnv },
      fetch: ghl.fetch,
      record: (entry) => void records.push(entry),
    });

    expect(ghl.fetch).not.toHaveBeenCalled();
    expect(result).toEqual({ templateId: "dry-run-2026-11-09-v2", mode: "recorded" });
    expect(records).toEqual([
      {
        target: "distribution",
        action: "createTemplate",
        payload: {
          method: "POST",
          url: "https://services.leadconnectorhq.com/emails/builder",
          body: {
            locationId: "loc_test",
            title: "2026-11-09 v2: Synthetic subject line",
            type: "html",
            builderVersion: "2",
            html: INPUT.html,
          },
        },
      },
      {
        target: "distribution",
        action: "setTemplateHtml",
        payload: {
          method: "POST",
          url: "https://services.leadconnectorhq.com/emails/builder/data",
          body: {
            locationId: "loc_test",
            templateId: "dry-run-2026-11-09-v2",
            updatedBy: "user_test",
            editorType: "html",
            html: INPUT.html,
          },
        },
      },
    ]);
    expect(JSON.stringify(records)).not.toContain(TOKEN);
  });

  it("does not need the GHL settings", async () => {
    const records: SideEffectRecord[] = [];

    const result = await createDraftTemplate(INPUT, {
      env: { APP_ENV: "preview" },
      record: (entry) => void records.push(entry),
    });

    expect(result.mode).toBe("recorded");
    expect(records).toHaveLength(2);
  });
});
