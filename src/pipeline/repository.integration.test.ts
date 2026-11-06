// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/repository.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { raiseAlert, resolveAlert } from "@/src/pipeline/alerts";
import { finishRun, logEvent, startRun } from "@/src/pipeline/runs";
import { readSetting, writeSetting } from "@/src/pipeline/settings";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the pipeline integration test against production.");
}

describe.skipIf(!enabled)("pipeline tables on a real database", () => {
  const tag = `it-${randomUUID()}`;
  const incidentKey = `${tag}:incident`;
  const settingKey = `${tag}:setting`;
  const runIds: bigint[] = [];

  afterAll(async () => {
    await prisma.pipelineRun.deleteMany({ where: { id: { in: runIds } } });
    await prisma.alert.deleteMany({ where: { incidentKey } });
    await prisma.pipelineSetting.deleteMany({ where: { key: settingKey } });
  });

  it("stores and replaces a setting", async () => {
    await writeSetting(settingKey, { owner: "n8n" });
    await writeSetting(settingKey, { owner: "native" });
    expect(await readSetting(settingKey)).toEqual({ owner: "native" });
  });

  it("records a run with its events, and cascades deletes", async () => {
    const runId = await startRun({ job: `${tag}:job`, trigger: "manual" }, new Date());
    runIds.push(runId);
    await logEvent(runId, { level: "info", step: "probe", message: "hello", data: { n: 1 } });
    await finishRun(runId, { status: "succeeded", stats: { events: 1 } }, new Date());

    const run = await prisma.pipelineRun.findUniqueOrThrow({ where: { id: runId }, include: { events: true } });
    expect(run.status).toBe("succeeded");
    expect(run.finishedAt).not.toBeNull();
    expect(run.events.map((event) => event.message)).toEqual(["hello"]);
  });

  it("rejects a status outside the allowed values", async () => {
    await expect(
      prisma.pipelineRun.create({ data: { job: `${tag}:bad`, trigger: "manual", status: "done" } }),
    ).rejects.toThrow();
  });

  it("keeps one open alert per incident, and reopens after resolve", async () => {
    const first = await raiseAlert({ incidentKey, severity: "warning", message: "first" }, new Date());
    const again = await raiseAlert({ incidentKey, severity: "critical", message: "again" }, new Date());
    expect(first.opened).toBe(true);
    expect(again.opened).toBe(false);
    expect(again.alert.id).toBe(first.alert.id);
    expect(again.alert.severity).toBe("critical");

    const resolved = await resolveAlert(incidentKey, new Date());
    expect(resolved?.status).toBe("resolved");
    expect(resolved?.openIncidentKey).toBeNull();
    expect(await resolveAlert(incidentKey, new Date())).toBeNull();

    const reopened = await raiseAlert({ incidentKey, severity: "warning", message: "back" }, new Date());
    expect(reopened.opened).toBe(true);
    expect(reopened.alert.id).not.toBe(first.alert.id);
  });
});
