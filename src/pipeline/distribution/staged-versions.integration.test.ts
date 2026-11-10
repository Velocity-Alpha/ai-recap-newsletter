// Opt-in: runs against a real database with the staged_versions migration applied, and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/distribution/staged-versions.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
// The run log and incidents are mocked, and the distribution service is a fake: the test writes only its own
// issue, draft, and staged version rows, and calls no outside service.
import { randomInt, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/src/pipeline/runs", () => ({
  startRun: vi.fn(async () => BigInt(1)),
  logEvent: vi.fn(async () => undefined),
  finishRun: vi.fn(async () => undefined),
}));
vi.mock("@/src/pipeline/notify", () => ({
  raiseIncident: vi.fn(async () => ({ opened: false, alertId: null, delivery: "skipped" })),
  resolveIncident: vi.fn(async () => ({ resolved: false, delivery: "skipped" })),
}));

import type { Prisma } from "@/src/generated/prisma";
import type { DistributionService } from "@/src/pipeline/distribution/service";
import { stageDraft } from "@/src/pipeline/distribution/stage-draft";
import { SAMPLE_CONTENT } from "@/src/pipeline/draft/draft.fixture";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";
import type { PublishedIssueContent } from "@/src/pipeline/publish/sent-email-parser";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the staged versions integration test against production.");
}

const MIGRATION = path.join(process.cwd(), "prisma/migrations/20261110210000_add_staged_versions/migration.sql");

/** The migration's backfill statement, between its two marker comments. */
function backfillSql(): string {
  const sql = readFileSync(MIGRATION, "utf8");
  const statement = sql.slice(sql.indexOf("-- backfill:start"), sql.indexOf("-- backfill:end")).replace("-- backfill:start", "").trim();
  if (!statement.startsWith("INSERT INTO")) throw new Error("The backfill statement was not found in the migration.");
  return statement;
}

class Rollback extends Error {}

describe.skipIf(!enabled)("staged versions on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // Far-future dates no real issue uses, different on each run.
  const month = String(randomInt(1, 13)).padStart(2, "0");
  const dayOfMonth = randomInt(1, 26);
  const dates = [0, 1, 2].map((offset) => `2098-${month}-${String(dayOfMonth + offset).padStart(2, "0")}`);
  const days = dates.map((date) => new Date(`${date}T00:00:00.000Z`));
  const content = { ...SAMPLE_CONTENT, title: `Pretend Lab Plans Test ${tag.slice(3, 11)}` } as unknown as Prisma.InputJsonValue;

  async function cleanUp() {
    const issues = await prisma.issue.findMany({ where: { issueDate: { in: days } }, select: { id: true } });
    const issueIds = issues.map((issue) => issue.id);
    await prisma.publishEvent.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.stagedVersion.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.issueDraft.deleteMany({ where: { issueId: { in: issueIds } } });
    await prisma.issue.deleteMany({ where: { id: { in: issueIds } } });
  }

  beforeAll(cleanUp);
  afterAll(cleanUp);

  it("backfills each ready draft that has a template as a staged version with the draft's number, and no other draft", async () => {
    const finishedAt = new Date("2098-01-01T12:00:00.000Z");
    let rows: Array<Record<string, unknown>> = [];

    // Everything here is rolled back, so the backfill changes nothing on the branch.
    await prisma
      .$transaction(
        async (tx) => {
          const issue = await tx.issue.create({ data: { title: `${tag} backfill`, issueDate: days[0] }, select: { id: true } });
          const ready = { outlineId: 1n, status: "ready", content, html: "<html>draft</html>", featuredImageUrl: "https://assets.example.test/a.jpg", scenePrompt: "A pretend lab.", finishedAt };
          const draft = (version: number, extra: Partial<Prisma.IssueDraftUncheckedCreateInput> = {}) =>
            tx.issueDraft.create({ data: { ...ready, ...extra, issueId: issue.id, version }, select: { id: true } });
          const v1 = await draft(1, { ghlTemplateId: `${tag}-tpl-1` });
          // Ready, but it has no email in the service.
          await draft(2);
          // It has a template id, but it failed.
          await draft(3, { status: "failed", ghlTemplateId: `${tag}-tpl-3` });
          const v4 = await draft(4, { html: "<html>draft 4</html>", ghlTemplateId: `${tag}-tpl-4`, ghlPreviewUrl: "https://preview.example/4" });

          await tx.$executeRawUnsafe(backfillSql());
          // Running it again changes nothing.
          await tx.$executeRawUnsafe(backfillSql());

          const staged = await tx.stagedVersion.findMany({ where: { issueId: issue.id }, orderBy: { version: "asc" } });
          rows = staged.map((row) => ({ ...row, isV1: row.draftId === v1.id, isV4: row.draftId === v4.id }));
          throw new Rollback();
        },
        { timeout: 30_000 },
      )
      .catch((error: unknown) => {
        if (!(error instanceof Rollback)) throw error;
      });

    expect(rows.map((row) => row.version)).toEqual([1, 4]);
    expect(rows[0]).toMatchObject({
      isV1: true,
      status: "staged",
      title: (content as { title: string }).title,
      html: "<html>draft</html>",
      featuredImageUrl: "https://assets.example.test/a.jpg",
      scenePrompt: "A pretend lab.",
      service: "ghl",
      serviceRef: `${tag}-tpl-1`,
      serviceUrl: null,
      stagedAt: finishedAt,
    });
    expect(rows[0].content).toEqual(content);
    expect(rows[1]).toMatchObject({ isV4: true, html: "<html>draft 4</html>", serviceRef: `${tag}-tpl-4`, serviceUrl: "https://preview.example/4" });
    expect(await prisma.issue.count({ where: { issueDate: days[0] } })).toBe(0);
  });

  it("makes one staged version when two staging requests for a draft arrive together", async () => {
    const issue = await prisma.issue.create({ data: { title: `${tag} staging`, issueDate: days[1] }, select: { id: true } });
    const draft = await prisma.issueDraft.create({
      data: { issueId: issue.id, version: 1, outlineId: 1n, status: "ready", content, html: "<html>draft</html>", featuredImageUrl: "https://assets.example.test/a.jpg", scenePrompt: "A pretend lab." },
      select: { id: true },
    });
    const emails: string[] = [];
    const service: DistributionService = {
      key: "fake",
      displayName: "Fake Mail",
      async createEmail({ name }) {
        emails.push(name);
        // Long enough for the other request to reach its checks while this one is still staging.
        await new Promise((resolve) => setTimeout(resolve, 1_500));
        return { ref: `${tag}-ref`, url: null, mode: "recorded" };
      },
    };
    const deps = { env: { APP_ENV: "development" }, service };

    const results = await Promise.allSettled([stageDraft(draft.id, {}, deps), stageDraft(draft.id, {}, deps)]);

    expect(results.map((result) => result.status).sort()).toEqual(["fulfilled", "rejected"]);
    const refused = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    expect(refused?.reason).toMatchObject({ name: "StageError", code: "staging_running", message: "Staging is already running." });
    expect(emails).toEqual([`${dates[1]} v1: ${(content as { title: string }).title}`]);
    const staged = await prisma.stagedVersion.findMany({ where: { issueId: issue.id } });
    expect(staged).toHaveLength(1);
    expect(staged[0]).toMatchObject({ version: 1, status: "staged", draftId: draft.id, service: "fake", serviceRef: `${tag}-ref` });
    expect(staged[0].html).toContain(`data-version-id="${staged[0].id}"`);

    // The draft has not changed: a third request is refused until the owner confirms, then makes v2.
    await expect(stageDraft(draft.id, {}, deps)).rejects.toMatchObject({ code: "already_staged", version: 1 });
    await expect(stageDraft(draft.id, { confirmRepeat: true }, deps)).resolves.toMatchObject({ version: 2 });
    const first = await prisma.stagedVersion.findUniqueOrThrow({ where: { id: staged[0].id } });
    expect(first).toEqual(staged[0]);
  }, 30_000);

  it("publishes the issue from the staged version a sent email names, and saves its id on the publish event", async () => {
    const issue = await prisma.issue.create({ data: { title: `${tag} publish`, issueDate: days[2], html: "<html>newest draft</html>" }, select: { id: true } });
    const issueId = Number(issue.id);
    const version = await prisma.stagedVersion.create({
      data: { issueId: issue.id, version: 1, draftId: 41n, status: "staged", title: "T", content, html: "<html>staged</html>", featuredImageUrl: "https://assets.example.test/a.jpg", scenePrompt: "A pretend lab.", service: "fake", stagedAt: new Date() },
      select: { id: true },
    });
    const publishedAt = new Date("2098-01-01T15:30:00.000Z");

    const outcome = await createPrismaPublishStore().publish({
      issueId,
      content: { issue_id: issueId, title: "Title From The Email" } as unknown as PublishedIssueContent,
      storyIds: [],
      publishedAt,
      event: { mode: "native", outcome: "published", gmailMessageId: `${tag}-m1`, receivedAt: publishedAt, issueId, subject: "S", title: "T", storyIds: [], contentJson: null, problems: [], draftId: 41, versionId: Number(version.id) },
    });

    expect(outcome).toBe("published");
    expect(await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({ publishedAt, html: "<html>staged</html>", title: (content as { title: string }).title });
    const events = await prisma.publishEvent.findMany({ where: { issueId: issue.id } });
    expect(events).toMatchObject([{ outcome: "published", draftId: 41n, stagedVersionId: version.id }]);
  });
});
