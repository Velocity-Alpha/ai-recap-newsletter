import { checkStageChange, currentOwner, type StageSwitch } from "@/src/features/admin/stage-switches";
import type { Prisma } from "@/src/generated/prisma";
import type { AdminSession } from "@/src/server/admin-auth";
import { prisma } from "@/src/server/prisma";

/**
 * Stage switch changes from /admin/settings. Each change is one `pipeline_runs` row (job `admin-setting`) with
 * one `pipeline_events` row, so the log needs no new table and shows up on /admin/runs.
 */
export const ADMIN_SETTING_JOB = "admin-setting";

export type StageChangeResult =
  | { status: "invalid"; reason: string }
  | { status: "unchanged"; reason: string }
  /** Another change to the same key committed first. Nothing was saved. */
  | { status: "conflict"; reason: string }
  | {
      status: "changed";
      key: string;
      /** The stored JSON before the change; null when there was no row. */
      from: Prisma.JsonValue | null;
      to: string;
      by: string;
      at: Date;
      runId: bigint;
    };

/** Postgres could not serialize the transaction against a concurrent one. */
function isSerializationFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && (error as { code?: unknown }).code === "P2034";
}

function describeFrom(stored: Prisma.JsonValue | null, defaultValue: string): string {
  if (stored === null) return `not set (${defaultValue})`;
  return typeof stored === "string" ? stored : JSON.stringify(stored);
}

async function applyChange(
  tx: Prisma.TransactionClient,
  stage: StageSwitch,
  to: string,
  session: AdminSession,
  now: Date,
): Promise<StageChangeResult> {
  const key = stage.key;
  const row = await tx.pipelineSetting.findUnique({ where: { key } });
  const from = row?.value ?? null;
  if (currentOwner(stage, from) === to) {
    const note = row ? "" : ` (not set, so the jobs use ${stage.defaultValue})`;
    return { status: "unchanged", reason: `${key} is already ${to}${note}. Nothing changed.` };
  }

  await tx.pipelineSetting.upsert({ where: { key }, create: { key, value: to }, update: { value: to } });
  const change = { key, from, to, by: session.actor };
  const run = await tx.pipelineRun.create({
    data: {
      job: ADMIN_SETTING_JOB,
      trigger: "manual",
      status: "succeeded",
      startedAt: now,
      finishedAt: now,
      stats: change,
      events: {
        create: {
          level: "info",
          step: "setting.change",
          message: `${key} changed from ${describeFrom(from, stage.defaultValue)} to ${to} by ${session.actor}.`,
          data: change,
          createdAt: now,
        },
      },
    },
    select: { id: true },
  });
  return { status: "changed", ...change, at: now, runId: run.id };
}

export async function changeStageOwner(
  input: { key: unknown; value: unknown },
  session: AdminSession,
  now: Date = new Date(),
): Promise<StageChangeResult> {
  const check = checkStageChange(input.key, input.value);
  if (!check.ok) return { status: "invalid", reason: check.reason };
  const { stage, option } = check;

  // One serializable transaction: the read, the setting, and its log row land together or not at all, and a
  // concurrent change to the same key fails (P2034) instead of logging a stale "from".
  try {
    return await prisma.$transaction((tx) => applyChange(tx, stage, option.value, session, now), {
      isolationLevel: "Serializable",
    });
  } catch (error) {
    if (!isSerializationFailure(error)) throw error;
    return {
      status: "conflict",
      reason: `Another change to ${stage.key} happened at the same time. Nothing was saved. Reload the page and try again.`,
    };
  }
}

export type StageChangeRow = { runId: string; at: Date; key: string; from: string; to: string; by: string };

function statText(value: Prisma.JsonValue | undefined): string {
  if (value === undefined) return "unknown";
  if (value === null) return "not set";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The newest stage switch changes, for the log on /admin/settings. */
export async function listStageChanges(limit: number): Promise<StageChangeRow[]> {
  const runs = await prisma.pipelineRun.findMany({
    where: { job: ADMIN_SETTING_JOB },
    orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    take: limit,
  });
  return runs.map((run) => {
    const stats = (run.stats && typeof run.stats === "object" && !Array.isArray(run.stats) ? run.stats : {}) as Record<
      string,
      Prisma.JsonValue | undefined
    >;
    return {
      runId: run.id.toString(),
      at: run.startedAt,
      key: statText(stats.key),
      from: statText(stats.from),
      to: statText(stats.to),
      by: statText(stats.by),
    };
  });
}
