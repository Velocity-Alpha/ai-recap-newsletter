import { describe, expect, it } from "vitest";

import {
  checkStageChange,
  currentOwner,
  findStageSwitch,
  STAGE_SWITCHES,
  toStageSwitchView,
} from "@/src/features/admin/stage-switches";
import { INGEST_OWNER_KEY } from "@/src/pipeline/ingest/run-ingest";
import { PUBLISH_OWNER_KEY } from "@/src/pipeline/publish/run-detect-publish";

describe("stage switches config", () => {
  it("lists the three stages in pipeline order, using the jobs' own keys", () => {
    expect(STAGE_SWITCHES.map((stage) => stage.key)).toEqual([INGEST_OWNER_KEY, "draft.owner", PUBLISH_OWNER_KEY]);
    expect(INGEST_OWNER_KEY).toBe("ingest.owner");
    expect(PUBLISH_OWNER_KEY).toBe("publish.owner");
  });

  it("offers n8n and native for every stage, each with a plain sentence about what happens", () => {
    for (const stage of STAGE_SWITCHES) {
      expect(stage.options.map((option) => option.value)).toEqual(["n8n", "native"]);
      for (const option of stage.options) expect(option.consequence).toMatch(/^\S.{20,}\.$/);
    }
  });

  it("says when stories are collected if ingestion moves to this app", () => {
    const native = findStageSwitch("ingest.owner")?.options.find((option) => option.value === "native");

    expect(native?.consequence).toContain("Stories will be collected by this app at 09:55");
    expect(native?.consequence).toContain("not by n8n");
  });

  it("shows native drafting but keeps it disabled until #79", () => {
    const draft = findStageSwitch("draft.owner");

    expect(draft?.options.find((option) => option.value === "native")?.disabledReason).toBe(
      "Native drafting is not built yet (#79)",
    );
    expect(draft?.options.find((option) => option.value === "n8n")?.disabledReason).toBeUndefined();
    for (const key of ["ingest.owner", "publish.owner"]) {
      expect(findStageSwitch(key)?.options.every((option) => option.disabledReason === undefined)).toBe(true);
    }
  });
});

describe("checkStageChange", () => {
  it("accepts an allowed value for a known switch", () => {
    const check = checkStageChange("ingest.owner", "native");

    expect(check.ok).toBe(true);
    if (check.ok) {
      expect(check.stage.key).toBe("ingest.owner");
      expect(check.option.value).toBe("native");
    }
  });

  it("refuses an unknown key", () => {
    expect(checkStageChange("pipeline.runner", "trigger")).toEqual({
      ok: false,
      reason: "pipeline.runner is not a stage switch.",
    });
    expect(checkStageChange(undefined, "native")).toEqual({ ok: false, reason: "Choose a stage switch." });
  });

  it("refuses a value outside the config", () => {
    expect(checkStageChange("publish.owner", "shadow")).toEqual({
      ok: false,
      reason: "shadow is not allowed for publish.owner. Use n8n or native.",
    });
    expect(checkStageChange("publish.owner", 1)).toEqual({
      ok: false,
      reason: "1 is not allowed for publish.owner. Use n8n or native.",
    });
  });

  it("refuses a disabled value with its reason", () => {
    expect(checkStageChange("draft.owner", "native")).toEqual({
      ok: false,
      reason: "Native drafting is not built yet (#79)",
    });
  });
});

describe("currentOwner", () => {
  const ingest = findStageSwitch("ingest.owner")!;

  it("is n8n when the row is missing, like the jobs", () => {
    expect(currentOwner(ingest, null)).toBe("n8n");
  });

  it("is the stored string, even one the page does not offer", () => {
    expect(currentOwner(ingest, "native")).toBe("native");
    expect(currentOwner(ingest, "shadow")).toBe("shadow");
  });

  it("shows other JSON as text", () => {
    expect(currentOwner(ingest, { owner: "native" })).toBe('{"owner":"native"}');
  });
});

describe("toStageSwitchView", () => {
  it("gives the page plain data: current owner, options, and when it last changed", () => {
    const view = toStageSwitchView(findStageSwitch("draft.owner")!, {
      value: "n8n",
      updatedAt: new Date("2026-11-09T04:05:00Z"),
    });

    expect(view).toMatchObject({
      key: "draft.owner",
      stage: "Draft",
      current: "n8n",
      isSet: true,
      updatedAt: "2026-11-09T04:05:00.000Z",
    });
    expect(view.options).toEqual([
      expect.objectContaining({ value: "n8n", isCurrent: true }),
      expect.objectContaining({
        value: "native",
        isCurrent: false,
        disabledReason: "Native drafting is not built yet (#79)",
      }),
    ]);
  });

  it("words the publish confirmations for shadow, where this app only records and n8n publishes", () => {
    const publish = findStageSwitch("publish.owner")!;

    const fromShadow = toStageSwitchView(publish, { value: "shadow", updatedAt: new Date() });
    const fromNative = toStageSwitchView(publish, { value: "native", updatedAt: new Date() });

    expect(fromShadow.current).toBe("shadow");
    expect(fromShadow.options.map((option) => [option.value, option.isCurrent, option.consequence])).toEqual([
      [
        "n8n",
        false,
        "This app will stop recording what it would publish (shadow). n8n keeps marking sent issues as published, if its Gmail Listen workflow is on.",
      ],
      [
        "native",
        false,
        "This app will start marking each sent issue as published, instead of only recording what it would do. Turn the n8n Gmail Listen workflow off so it does not do the same.",
      ],
    ]);
    expect(fromNative.options[0].consequence).toBe(publish.options[0].consequence);
    expect(fromShadow.options[0]).not.toHaveProperty("consequenceFrom");
  });

  it("marks a missing row as not set", () => {
    const view = toStageSwitchView(findStageSwitch("publish.owner")!, null);

    expect(view).toMatchObject({ current: "n8n", isSet: false, updatedAt: null });
  });
});
