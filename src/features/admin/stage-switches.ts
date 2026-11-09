import type { Prisma } from "@/src/generated/prisma";
import { INGEST_OWNER_KEY } from "@/src/pipeline/ingest/run-ingest";
import { PUBLISH_OWNER_KEY } from "@/src/pipeline/publish/run-detect-publish";

/**
 * The stage owner switches on /admin/settings (#54), and the only place their allowed values live. The page,
 * the POST route, and the tests all read this list.
 */

// draft.owner is defined in src/pipeline/draft/outline-store.ts on an unmerged branch (#124).
// After #124 merges, replace this line with: import { DRAFT_OWNER_KEY } from "@/src/pipeline/draft/outline-store";
const DRAFT_OWNER_KEY = "draft.owner";

export type StageOwnerValue = "n8n" | "native";

export type StageOption = {
  value: StageOwnerValue;
  label: string;
  /** Shown when the owner confirms the change: what will happen, in plain words. */
  consequence: string;
  /** Set to show the value but refuse it. */
  disabledReason?: string;
};

export type StageSwitch = {
  key: string;
  stage: string;
  description: string;
  /** What the job does when the row is missing. */
  defaultValue: StageOwnerValue;
  options: readonly StageOption[];
};

export const STAGE_SWITCHES: readonly StageSwitch[] = [
  {
    key: INGEST_OWNER_KEY,
    stage: "Ingest",
    description: "Collects the day's stories from newsletters and feeds for the board.",
    defaultValue: "n8n",
    options: [
      {
        value: "n8n",
        label: "n8n",
        consequence:
          "This app will stop collecting stories. Stories arrive only if you also turn the n8n ingestion workflows back on.",
      },
      {
        value: "native",
        label: "Native",
        consequence:
          "Stories will be collected by this app at 09:55 New York time on weekdays, not by n8n. Turn the n8n ingestion workflows off so stories are not collected twice.",
      },
    ],
  },
  {
    key: DRAFT_OWNER_KEY,
    stage: "Draft",
    description: "Writes the issue, its featured image, and the GHL template after you commit an outline.",
    defaultValue: "n8n",
    options: [
      {
        value: "n8n",
        label: "n8n",
        consequence: "n8n will draft the issue each time you commit an outline. This app will not.",
      },
      {
        value: "native",
        label: "Native",
        consequence: "This app will draft the issue each time you commit an outline, not n8n.",
        // #79: delete this line to allow native drafting.
        disabledReason: "Native drafting is not built yet (#79)",
      },
    ],
  },
  {
    key: PUBLISH_OWNER_KEY,
    stage: "Publish",
    description: "Marks an issue as published on the site once its sent email reaches the seed inbox.",
    defaultValue: "n8n",
    options: [
      {
        value: "n8n",
        label: "n8n",
        consequence:
          "This app will stop marking sent issues as published. They appear on the site only if you also turn the n8n Gmail Listen workflow back on, or use Mark as published.",
      },
      {
        value: "native",
        label: "Native",
        consequence:
          "This app will mark each sent issue as published when its email reaches the seed inbox, not n8n. Turn the n8n Gmail Listen workflow off so it does not do the same.",
      },
    ],
  },
];

export function findStageSwitch(key: string): StageSwitch | undefined {
  return STAGE_SWITCHES.find((stage) => stage.key === key);
}

/** The owner the jobs see: the stored string, or the default when the row is missing. */
export function currentOwner(stage: StageSwitch, stored: Prisma.JsonValue | null): string {
  if (stored === null) return stage.defaultValue;
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

export type StageChangeCheck =
  | { ok: true; stage: StageSwitch; option: StageOption }
  | { ok: false; reason: string };

/** Validates a requested change against the config. It does not know the current value. */
export function checkStageChange(key: unknown, value: unknown): StageChangeCheck {
  if (typeof key !== "string" || !key) return { ok: false, reason: "Choose a stage switch." };
  const stage = findStageSwitch(key);
  if (!stage) return { ok: false, reason: `${key} is not a stage switch.` };

  const option = stage.options.find((candidate) => candidate.value === value);
  if (!option) {
    const allowed = stage.options.map((candidate) => candidate.value).join(" or ");
    return { ok: false, reason: `${String(value)} is not allowed for ${key}. Use ${allowed}.` };
  }
  if (option.disabledReason) return { ok: false, reason: option.disabledReason };
  return { ok: true, stage, option };
}

/** Plain data for the client component (it cannot import this module: the job modules load Prisma). */
export type StageSwitchView = {
  key: string;
  stage: string;
  description: string;
  current: string;
  /** False when no row exists and the jobs use the default. */
  isSet: boolean;
  updatedAt: string | null;
  options: Array<StageOption & { isCurrent: boolean }>;
};

export function toStageSwitchView(
  stage: StageSwitch,
  row: { value: Prisma.JsonValue; updatedAt: Date } | null,
): StageSwitchView {
  const current = currentOwner(stage, row?.value ?? null);
  return {
    key: stage.key,
    stage: stage.stage,
    description: stage.description,
    current,
    isSet: row !== null,
    updatedAt: row?.updatedAt.toISOString() ?? null,
    options: stage.options.map((option) => ({ ...option, isCurrent: option.value === current })),
  };
}
