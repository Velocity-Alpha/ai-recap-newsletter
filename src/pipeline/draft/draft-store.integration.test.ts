// Opt-in: runs against a real database with the issue_drafts migrations applied, and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/draft/draft-store.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
// The owner switch, run log, and incidents are mocked: the test writes only its own issue, draft, outline, and
// story rows, and calls no outside service.
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/src/pipeline/settings", () => ({
  readSetting: vi.fn(async (key: string) => (key === "draft.owner" ? "native" : null)),
}));
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
import type { WrittenIssueContent } from "@/src/pipeline/draft/content";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import { createDraft } from "@/src/pipeline/draft/draft-store";
import type { ApprovalOutline } from "@/src/pipeline/draft/outline";
import { runDraftJob } from "@/src/pipeline/draft/run-draft";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the draft store integration test against production.");
}

describe.skipIf(!enabled)("draft store on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // A far-future date no real issue uses, different on each run.
  const date = `2099-${String(randomInt(1, 13)).padStart(2, "0")}-${String(randomInt(1, 29)).padStart(2, "0")}`;
  const day = new Date(`${date}T00:00:00.000Z`);
  // Fixture story id -> the real row made for it.
  const storyIds = new Map<number, number>();
  let outline: ApprovalOutline;

  beforeAll(async () => {
    for (const story of Object.values(SAMPLE_APPROVED).flat()) {
      const row = await prisma.story.create({
        data: { guid: `${tag}-${story.id}`, headline: story.headline, summary: story.summary, storyDetails: story.storyDetails, url: story.url },
        select: { id: true },
      });
      storyIds.set(story.id, row.id);
    }
    const real = (id: number) => storyIds.get(id)!;
    outline = {
      ...SAMPLE_OUTLINE,
      date,
      sections: SAMPLE_OUTLINE.sections.map((section) => ({ key: section.key, storyIds: section.storyIds.map(real) })),
      leadStoryId: SAMPLE_OUTLINE.leadStoryId === null ? null : real(SAMPLE_OUTLINE.leadStoryId),
      stories: [],
      excluded: [],
    };
  });

  afterAll(async () => {
    const issues = await prisma.issue.findMany({ where: { issueDate: day }, select: { id: true } });
    await prisma.issueDraft.deleteMany({ where: { issueId: { in: issues.map((issue) => issue.id) } } });
    await prisma.issue.deleteMany({ where: { issueDate: day } });
    await prisma.approvalOutline.deleteMany({ where: { issueDate: day } });
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
  });

  async function saveOutline(): Promise<bigint> {
    const row = await prisma.approvalOutline.create({
      data: { issueDate: day, payload: outline as unknown as Prisma.InputJsonValue, payloadHash: tag, draftOwner: "native" },
      select: { id: true },
    });
    return row.id;
  }

  /** The fixture content, pointing at this test's story rows, with a title no other issue has. */
  function writtenContent(): WrittenIssueContent {
    const json = JSON.stringify(SAMPLE_CONTENT).replace(/"story_id":(\d+)/g, (_match, id: string) => `"story_id":${storyIds.get(Number(id))}`);
    return { ...(JSON.parse(json) as WrittenIssueContent), title: `Pretend Lab Plans Test ${tag.slice(3, 11)}` };
  }

  it("makes one issue and versions 1 and 2 when two commits for a date arrive together", async () => {
    const [first, second] = await Promise.all([createDraft(await saveOutline()), createDraft(await saveOutline())]);

    expect(first.issueId).toBe(second.issueId);
    expect([first.version, second.version].sort()).toEqual([1, 2]);
    expect(await prisma.issue.count({ where: { issueDate: day } })).toBe(1);
  });

  it("claims a draft once when two starts for it run together", async () => {
    const created = await createDraft(await saveOutline());
    const writer = vi.fn(async () => writtenContent());
    const deps = {
      writer,
      makeImage: vi.fn(async () => ({ imageUrl: "https://assets.example.test/newsletter-dev/it.jpg", scenePrompt: "A pretend lab." })),
      createTemplate: vi.fn(async () => ({ templateId: `${tag}-tpl`, mode: "recorded" as const })),
    };
    const options = { env: { APP_ENV: "development" }, deps };

    const results = await Promise.all([runDraftJob(created.draftId, options), runDraftJob(created.draftId, options)]);

    expect(results.filter((result) => result.status === "skipped")).toHaveLength(1);
    expect(results.find((result) => result.status !== "skipped")).toMatchObject({ status: "ready", draftId: created.draftId });
    expect(writer).toHaveBeenCalledTimes(1);
    const draft = await prisma.issueDraft.findUniqueOrThrow({ where: { id: BigInt(created.draftId) } });
    expect(draft).toMatchObject({ status: "ready", failedStep: null });
    expect(draft.startedAt).not.toBeNull();
  });
});
