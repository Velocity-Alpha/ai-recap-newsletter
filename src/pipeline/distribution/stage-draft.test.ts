import { beforeEach, describe, expect, it, vi } from "vitest";

const runLog = vi.hoisted(() => ({ started: [] as unknown[], events: [] as Array<Record<string, unknown>>, finished: [] as Array<Record<string, unknown>> }));
const notify = vi.hoisted(() => ({ raiseIncident: vi.fn(), resolveIncident: vi.fn() }));

vi.mock("@/src/server/prisma", async () => {
  const { fakeDb } = await import("@/src/pipeline/draft/fake-db.fixture");
  return { prisma: fakeDb.client };
});
vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async (input: unknown) => {
    runLog.started.push(input);
    return BigInt(9);
  }),
  logEvent: vi.fn(async (_runId: bigint, event: Record<string, unknown>) => {
    runLog.events.push(event);
  }),
  finishRun: vi.fn(async (_runId: bigint, result: Record<string, unknown>) => {
    runLog.finished.push(result);
  }),
}));
vi.mock("@/src/pipeline/notify", () => notify);

import type { DistributionService } from "@/src/pipeline/distribution/service";
import { StageError, stageDraft } from "@/src/pipeline/distribution/stage-draft";
import { IssuePublishedError } from "@/src/pipeline/draft/draft-store";
import { SAMPLE_CONTENT } from "@/src/pipeline/draft/draft.fixture";
import { fakeDb } from "@/src/pipeline/draft/fake-db.fixture";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";

const DATE = "2027-01-04";
const DAY = new Date(`${DATE}T00:00:00.000Z`);
const NOW = new Date("2027-01-04T15:00:00.000Z");
const IMAGE_URL = "https://assets.example.test/newsletter-dev/2027-01-04.jpg";
const ENV = { APP_ENV: "development" };

type Email = { name: string; html: string };

function fakeService(createEmail?: (input: Email) => ReturnType<DistributionService["createEmail"]>) {
  const emails: Email[] = [];
  const service: DistributionService = {
    key: "fake",
    displayName: "Fake Mail",
    createEmail: vi.fn(async (input: Email) => {
      emails.push(input);
      if (createEmail) return createEmail(input);
      return { ref: `ref-${emails.length}`, url: `https://service.example.test/emails/${emails.length}`, mode: "sent" as const };
    }),
  };
  return { service, emails };
}

async function issueRow(data: Record<string, unknown> = {}): Promise<bigint> {
  const row = await fakeDb.client.issue.create({ data: { title: "A draft", issueDate: DAY, ...data } });
  return (row as { id: bigint }).id;
}

async function draftRow(issueId: bigint, data: Record<string, unknown> = {}): Promise<number> {
  const row = await fakeDb.client.issueDraft.create({
    data: {
      issueId,
      version: 1,
      outlineId: 1n,
      status: "ready",
      content: SAMPLE_CONTENT,
      html: "<html>the draft's own preview</html>",
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend lab at dawn.",
      ...data,
    },
  });
  return Number((row as { id: bigint }).id);
}

const staged = () => fakeDb.state.stagedVersions.rows;

function refusal(code: string) {
  return expect.objectContaining({ name: "StageError", code });
}

beforeEach(() => {
  fakeDb.reset();
  runLog.started.length = 0;
  runLog.events.length = 0;
  runLog.finished.length = 0;
  notify.raiseIncident.mockReset().mockResolvedValue({ opened: true, alertId: 1n, delivery: "recorded" });
  notify.resolveIncident.mockReset().mockResolvedValue({ resolved: false, delivery: "skipped" });
});

describe("stageDraft", () => {
  it("creates v1 for a new issue: one email named by date, version, and title, and one staged row with the copies", async () => {
    const issueId = await issueRow();
    const draftId = await draftRow(issueId);
    const { service, emails } = fakeService();

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    expect(emails).toHaveLength(1);
    expect(emails[0].name).toBe(`${DATE} v1: ${SAMPLE_CONTENT.title}`);
    expect(staged()).toHaveLength(1);
    expect(staged()[0]).toMatchObject({
      issueId,
      version: 1,
      draftId: BigInt(draftId),
      status: "staged",
      title: SAMPLE_CONTENT.title,
      featuredImageUrl: IMAGE_URL,
      scenePrompt: "A pretend lab at dawn.",
      content: SAMPLE_CONTENT,
      html: emails[0].html,
      service: "fake",
      serviceRef: "ref-1",
      serviceUrl: "https://service.example.test/emails/1",
      stagedAt: NOW,
    });
    expect(result).toEqual({
      id: Number(staged()[0].id),
      version: 1,
      issueDate: DATE,
      title: SAMPLE_CONTENT.title,
      service: "fake",
      serviceName: "Fake Mail",
      serviceRef: "ref-1",
      serviceUrl: "https://service.example.test/emails/1",
      mode: "sent",
      stagedAt: NOW,
    });
  });

  it("puts the staged version's id in the email, next to the issue and draft ids", async () => {
    const issueId = await issueRow();
    const draftId = await draftRow(issueId);
    const { service, emails } = fakeService();

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    const parsed = parseSentEmail(emails[0].html);
    expect(parsed).toMatchObject({ versionId: result.id, draftId, problems: [] });
    expect(parsed?.content.issue_id).toBe(Number(issueId));
  });

  it("takes the per-date lock once", async () => {
    const draftId = await draftRow(await issueRow());

    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: fakeService().service });

    expect(fakeDb.state.locks).toEqual([["SELECT pg_advisory_xact_lock(hashtext(?))", `issue-date:${DATE}`]]);
  });

  it("creates the next version after a title change, and leaves the earlier row as it was", async () => {
    const draftId = await draftRow(await issueRow());
    const { service, emails } = fakeService();
    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });
    const first = structuredClone(staged()[0]);
    fakeDb.state.drafts.rows[0].content = { ...SAMPLE_CONTENT, title: "A Better Title" };

    const second = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    expect(second.version).toBe(2);
    expect(emails[1].name).toBe(`${DATE} v2: A Better Title`);
    expect(staged()).toHaveLength(2);
    expect(staged()[0]).toEqual(first);
    expect(staged()[1]).toMatchObject({ version: 2, title: "A Better Title", serviceRef: "ref-2" });
  });

  it("creates the next version after an image change", async () => {
    const draftId = await draftRow(await issueRow());
    const { service } = fakeService();
    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });
    fakeDb.state.drafts.rows[0].featuredImageUrl = "https://assets.example.test/newsletter-dev/other.jpg";

    const second = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    expect(second.version).toBe(2);
    expect(staged()[1]).toMatchObject({ featuredImageUrl: "https://assets.example.test/newsletter-dev/other.jpg" });
  });

  it("creates the next version for a newer draft of the issue", async () => {
    const issueId = await issueRow();
    const { service } = fakeService();
    await stageDraft(await draftRow(issueId), {}, { env: ENV, now: () => NOW, service });
    const newer = await draftRow(issueId, { version: 2 });

    const second = await stageDraft(newer, {}, { env: ENV, now: () => NOW, service });

    expect(second.version).toBe(2);
    expect(staged()[1]).toMatchObject({ draftId: BigInt(newer) });
  });

  it("refuses an unchanged draft with already_staged and the version, and creates nothing", async () => {
    const draftId = await draftRow(await issueRow());
    const { service, emails } = fakeService();
    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    const error = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service }).catch((e: unknown) => e);

    expect(error).toEqual(refusal("already_staged"));
    expect((error as StageError).version).toBe(1);
    expect(emails).toHaveLength(1);
    expect(staged()).toHaveLength(1);
  });

  it("stages an unchanged draft again when the owner confirms", async () => {
    const draftId = await draftRow(await issueRow());
    const { service, emails } = fakeService();
    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });

    const second = await stageDraft(draftId, { confirmRepeat: true }, { env: ENV, now: () => NOW, service });

    expect(second.version).toBe(2);
    expect(emails).toHaveLength(2);
  });

  it("makes one version from two requests at the same time: the second gets 'Staging is already running.'", async () => {
    const draftId = await draftRow(await issueRow());
    let release = () => {};
    const { service, emails } = fakeService(
      () => new Promise((resolve) => (release = () => resolve({ ref: "ref-1", url: null, mode: "sent" }))),
    );

    const first = stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });
    await vi.waitFor(() => expect(emails).toHaveLength(1));
    const second = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service }).catch((e: unknown) => e);
    release();
    await first;

    expect(second).toEqual(refusal("staging_running"));
    expect((second as Error).message).toBe("Staging is already running.");
    expect(emails).toHaveLength(1);
    expect(staged()).toHaveLength(1);
    expect(staged()[0]).toMatchObject({ version: 1, status: "staged" });
  });

  it("clears a crashed attempt (a staging row over 2 minutes old) and re-uses its number", async () => {
    const issueId = await issueRow();
    const draftId = await draftRow(issueId);
    await fakeDb.client.stagedVersion.create({
      data: { issueId, version: 1, draftId: BigInt(draftId), status: "staging", title: "T", content: {}, html: "", service: "fake", createdAt: new Date(NOW.getTime() - 121_000) },
    });

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: fakeService().service });

    expect(result.version).toBe(1);
    expect(staged()).toHaveLength(1);
    expect(staged()[0]).toMatchObject({ status: "staged" });
  });

  it("keeps a staging row under 2 minutes old: it is still running", async () => {
    const issueId = await issueRow();
    const draftId = await draftRow(issueId);
    await fakeDb.client.stagedVersion.create({
      data: { issueId, version: 1, draftId: BigInt(draftId), status: "staging", title: "T", content: {}, html: "", service: "fake", createdAt: new Date(NOW.getTime() - 119_000) },
    });

    await expect(stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: fakeService().service })).rejects.toEqual(refusal("staging_running"));
  });

  it("leaves no row, raises stage.failed:<date>, and gives the service's message when the service call fails", async () => {
    const draftId = await draftRow(await issueRow());
    const { service } = fakeService(async () => Promise.reject(new Error("The service said HTTP 401.")));

    const error = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service }).catch((e: unknown) => e);

    expect(error).toEqual(refusal("service_failed"));
    expect((error as Error).message).toBe("The service said HTTP 401.");
    expect(staged()).toHaveLength(0);
    expect(notify.raiseIncident).toHaveBeenCalledOnce();
    expect(notify.raiseIncident.mock.calls[0][0]).toMatchObject({
      incidentKey: `stage.failed:${DATE}`,
      severity: "warning",
      what: `Staging v1 for ${DATE} failed.`,
      evidence: "The service said HTTP 401.",
      link: `https://airecap.news/approval/drafts?date=${DATE}`,
    });
    expect(notify.resolveIncident).not.toHaveBeenCalled();
    expect(runLog.finished).toEqual([expect.objectContaining({ status: "failed", error: "The service said HTTP 401." })]);
  });

  it("resolves stage.failed:<date> on the next staging that works, as v1 again", async () => {
    const draftId = await draftRow(await issueRow());
    const failing = fakeService(async () => Promise.reject(new Error("The service said HTTP 500.")));
    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: failing.service }).catch(() => undefined);

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: fakeService().service });

    expect(result.version).toBe(1);
    expect(notify.resolveIncident).toHaveBeenCalledOnce();
    expect(notify.resolveIncident.mock.calls[0][0]).toBe(`stage.failed:${DATE}`);
    expect(notify.resolveIncident.mock.calls[0][1]).toMatchObject({ note: "v1 is staged." });
  });

  it("fails with a timeout when the service does not answer in time, and leaves no row", async () => {
    const draftId = await draftRow(await issueRow());
    const { service } = fakeService(() => new Promise(() => {}));

    const error = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service, timeoutMs: 5 }).catch((e: unknown) => e);

    expect(error).toEqual(refusal("service_failed"));
    expect((error as Error).message).toMatch(/^Creating the email in Fake Mail timed out after /);
    expect(staged()).toHaveLength(0);
  });

  it("tells the service to stop when it gives up at the timeout", async () => {
    const draftId = await draftRow(await issueRow());
    const signals: Array<AbortSignal | undefined> = [];
    const service: DistributionService = {
      key: "fake",
      displayName: "Fake Mail",
      createEmail: (input) => {
        signals.push(input.signal);
        return new Promise(() => {});
      },
    };

    await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service, timeoutMs: 5 }).catch(() => undefined);

    expect(signals).toHaveLength(1);
    expect(signals[0]?.aborted).toBe(true);
  });

  it("saves the staged version at the second try when the first save fails", async () => {
    const draftId = await draftRow(await issueRow());
    const { service, emails } = fakeService();
    const update = vi.spyOn(fakeDb.client.stagedVersion, "update").mockRejectedValueOnce(new Error("The connection dropped."));

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service });
    update.mockRestore();

    expect(result).toMatchObject({ version: 1, serviceRef: "ref-1" });
    expect(emails).toHaveLength(1);
    expect(staged()).toEqual([expect.objectContaining({ status: "staged", serviceRef: "ref-1" })]);
    expect(notify.raiseIncident).not.toHaveBeenCalled();
  });

  it("names the created email when the service call worked but the staged version cannot be saved", async () => {
    const draftId = await draftRow(await issueRow());
    const { service, emails } = fakeService();
    const update = vi.spyOn(fakeDb.client.stagedVersion, "update").mockRejectedValue(new Error("The database is down."));

    const error = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service }).catch((e: unknown) => e);
    update.mockRestore();

    expect(error).toEqual(refusal("not_saved"));
    expect((error as Error).message).toBe(
      "The email was created in Fake Mail (ref-1), but v1 could not be saved: The database is down. " +
        "Staging again makes a second email with the same name. Delete ref-1 in Fake Mail first.",
    );
    expect(emails).toHaveLength(1);
    expect(staged()).toHaveLength(0);
    expect(notify.raiseIncident.mock.calls[0][0]).toMatchObject({
      incidentKey: `stage.failed:${DATE}`,
      evidence: expect.stringContaining("ref-1"),
      details: expect.objectContaining({ serviceRef: "ref-1" }),
    });
  });

  it("refuses a ready draft that has no title", async () => {
    const draftId = await draftRow(await issueRow(), { content: { ...SAMPLE_CONTENT, title: "  " } });
    const { service, emails } = fakeService();

    const error = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service }).catch((e: unknown) => e);

    expect(error).toEqual(refusal("not_ready"));
    expect((error as Error).message).toBe(`The draft for ${DATE} has no title. Only a ready draft can be staged.`);
    expect(emails).toHaveLength(0);
    expect(staged()).toHaveLength(0);
  });

  it("still stages when the incident cannot be resolved", async () => {
    const draftId = await draftRow(await issueRow());
    notify.resolveIncident.mockRejectedValue(new Error("alerts table is down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW, service: fakeService().service });

    expect(result.version).toBe(1);
    expect(staged()[0]).toMatchObject({ status: "staged" });
    logged.mockRestore();
  });

  it("refuses once the issue is published", async () => {
    const draftId = await draftRow(await issueRow({ publishedAt: NOW }));
    const { service, emails } = fakeService();

    await expect(stageDraft(draftId, {}, { env: ENV, now: () => NOW, service })).rejects.toBeInstanceOf(IssuePublishedError);
    expect(emails).toHaveLength(0);
    expect(staged()).toHaveLength(0);
  });

  it("refuses a draft that is not the newest draft of its issue, even when the newest is running", async () => {
    const issueId = await issueRow();
    const older = await draftRow(issueId);
    await draftRow(issueId, { version: 2, status: "running", content: null, html: null });

    await expect(stageDraft(older, {}, { env: ENV, now: () => NOW, service: fakeService().service })).rejects.toEqual(refusal("not_current"));
  });

  it.each(["running", "failed"])("refuses a %s draft", async (status) => {
    const draftId = await draftRow(await issueRow(), { status });
    const { service, emails } = fakeService();

    await expect(stageDraft(draftId, {}, { env: ENV, now: () => NOW, service })).rejects.toEqual(refusal("not_ready"));
    expect(emails).toHaveLength(0);
  });

  it("refuses a draft that does not exist", async () => {
    await expect(stageDraft(999, {}, { env: ENV, now: () => NOW, service: fakeService().service })).rejects.toEqual(refusal("missing"));
  });

  it("outside production, records the calls in the run log without the HTML, and nothing reaches the service", async () => {
    const draftId = await draftRow(await issueRow());
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    const result = await stageDraft(draftId, {}, { env: ENV, now: () => NOW });

    vi.unstubAllGlobals();
    expect(fetch).not.toHaveBeenCalled();
    expect(result).toMatchObject({ mode: "recorded", service: "ghl", serviceName: "GHL", serviceRef: `dry-run-${DATE}-v1`, serviceUrl: null });
    expect(staged()[0]).toMatchObject({ status: "staged", service: "ghl", serviceRef: `dry-run-${DATE}-v1` });
    expect(runLog.started).toEqual([{ job: "stage-draft", trigger: "manual" }]);
    const recorded = runLog.events.filter((event) => event.step === "stage");
    expect(recorded.map((event) => (event.data as { action: string }).action)).toEqual(["createTemplate", "setTemplateHtml"]);
    expect(JSON.stringify(recorded)).toMatch(/\[\d+ characters of HTML\]/);
    expect(JSON.stringify(recorded)).not.toContain("<html>");
    expect(runLog.finished).toEqual([expect.objectContaining({ status: "succeeded" })]);
  });
});
