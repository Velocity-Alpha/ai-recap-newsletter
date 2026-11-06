import type { Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";

export type RunTrigger = "schedule" | "manual" | "event";
export type RunStatus = "running" | "succeeded" | "failed";
export type EventLevel = "debug" | "info" | "warn" | "error";

export async function startRun(input: { job: string; trigger: RunTrigger }, now: Date): Promise<bigint> {
  const run = await prisma.pipelineRun.create({
    data: { job: input.job, trigger: input.trigger, status: "running", startedAt: now },
    select: { id: true },
  });
  return run.id;
}

export function finishRun(
  runId: bigint,
  result: { status: Exclude<RunStatus, "running">; stats?: Prisma.InputJsonValue; error?: string },
  now: Date,
) {
  return prisma.pipelineRun.update({
    where: { id: runId },
    data: { status: result.status, finishedAt: now, stats: result.stats, error: result.error ?? null },
  });
}

export function logEvent(
  runId: bigint,
  event: { level: EventLevel; step: string; message: string; data?: Prisma.InputJsonValue },
) {
  return prisma.pipelineEvent.create({
    data: { runId, level: event.level, step: event.step, message: event.message, data: event.data },
  });
}
