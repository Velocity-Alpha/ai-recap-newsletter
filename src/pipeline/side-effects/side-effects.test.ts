import { describe, expect, it, vi } from "vitest";

import {
  assertS3KeyAllowed,
  createSideEffects,
  s3KeyPrefix,
  type SideEffectRecord,
} from "@/src/pipeline/side-effects";

describe("createSideEffects", () => {
  it("sends in production and records nothing", async () => {
    const record = vi.fn();
    const send = vi.fn(async () => ({ id: "tpl_1" }));
    const effects = createSideEffects({ appEnv: "production", record });

    const outcome = await effects.run({
      target: "distribution",
      action: "createTemplate",
      payload: { name: "2026-11-09 v1: Subject" },
      send,
      dryRun: () => ({ id: "dry-run" }),
    });

    expect(effects.live).toBe(true);
    expect(send).toHaveBeenCalledOnce();
    expect(record).not.toHaveBeenCalled();
    expect(outcome).toEqual({ mode: "sent", value: { id: "tpl_1" } });
  });

  it.each(["preview", "development", undefined, "", "Production"])(
    "records the payload and never sends when APP_ENV is %j",
    async (appEnv) => {
      const records: SideEffectRecord[] = [];
      const send = vi.fn(async () => ({ id: "tpl_1" }));
      const effects = createSideEffects({ appEnv, record: (entry) => void records.push(entry) });

      const outcome = await effects.run({
        target: "distribution",
        action: "createTemplate",
        payload: { name: "2026-11-09 v1: Subject" },
        send,
        dryRun: () => ({ id: "dry-run" }),
      });

      expect(effects.live).toBe(false);
      expect(send).not.toHaveBeenCalled();
      expect(records).toEqual([
        { target: "distribution", action: "createTemplate", payload: { name: "2026-11-09 v1: Subject" } },
      ]);
      expect(outcome).toEqual({ mode: "recorded", value: { id: "dry-run" } });
    },
  );

  it("passes send errors through in production", async () => {
    const effects = createSideEffects({ appEnv: "production" });
    await expect(
      effects.run({
        target: "review_group",
        action: "sendMessage",
        payload: { text: "hi" },
        send: async () => {
          throw new Error("HTTP 401");
        },
        dryRun: () => undefined,
      }),
    ).rejects.toThrow("HTTP 401");
  });
});

describe("S3 keys", () => {
  it("uses the production prefix only in production", () => {
    expect(s3KeyPrefix("production")).toBe("newsletter/");
    expect(s3KeyPrefix("preview")).toBe("newsletter-dev/");
    expect(s3KeyPrefix(undefined)).toBe("newsletter-dev/");
  });

  it("refuses production keys outside production", () => {
    expect(() => assertS3KeyAllowed("preview", "newsletter/2026-11-09-abc.jpg")).toThrow(/newsletter-dev\//);
    expect(() => assertS3KeyAllowed("development", "other/2026-11-09-abc.jpg")).toThrow();
    expect(() => assertS3KeyAllowed("preview", "newsletter-dev/2026-11-09-abc.jpg")).not.toThrow();
    expect(() => assertS3KeyAllowed("production", "newsletter/2026-11-09-abc.jpg")).not.toThrow();
  });
});
