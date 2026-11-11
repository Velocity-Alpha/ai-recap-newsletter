// Opt-in: runs against a real database with the board_actions migration applied, and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/feedback/board-actions.integration.test.ts
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
// It writes only its own synthetic story, outline, issue, draft, and board action rows. The draft job's start call
// goes to a stub, so no outside service is called.
import { randomInt, randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { commitNativeDraft } from "@/src/pipeline/draft/native-commit";
import type { ApprovalOutline, ProposedBoard } from "@/src/pipeline/draft/outline";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the board actions integration test against production.");
}

describe.skipIf(!enabled)("board actions on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // A far-future date no real issue uses, different on each run.
  const date = `2099-${String(randomInt(1, 13)).padStart(2, "0")}-${String(randomInt(1, 29)).padStart(2, "0")}`;
  const day = new Date(`${date}T00:00:00.000Z`);
  const target = { siteUrl: "https://deploy-preview-1--ai-recap.netlify.app" };
  const options = {
    env: { SESSION_SECRET: "s".repeat(32) },
    fetch: vi.fn<typeof fetch>(async () => new Response(null, { status: 202 })),
  };
  let ids: Record<"a" | "b" | "c" | "d", number>;

  beforeAll(async () => {
    const make = async (name: string) =>
      (
        await prisma.story.create({
          data: { guid: `${tag}-${name}`, headline: `Synthetic ${name}`, url: `https://example.test/${tag}/${name}` },
          select: { id: true },
        })
      ).id;
    ids = { a: await make("a"), b: await make("b"), c: await make("c"), d: await make("d") };
  });

  afterAll(async () => {
    const outlines = await prisma.approvalOutline.findMany({ where: { issueDate: day }, select: { id: true } });
    await prisma.boardAction.deleteMany({ where: { outlineId: { in: outlines.map((row) => row.id) } } });
    const issues = await prisma.issue.findMany({ where: { issueDate: day }, select: { id: true } });
    await prisma.issueDraft.deleteMany({ where: { issueId: { in: issues.map((issue) => issue.id) } } });
    await prisma.issue.deleteMany({ where: { issueDate: day } });
    await prisma.approvalOutline.deleteMany({ where: { issueDate: day } });
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
  });

  function outline(sections: { key: string; storyIds: number[] }[], excluded: ApprovalOutline["excluded"]): ApprovalOutline {
    return {
      date,
      sections,
      leadStoryId: ids.a,
      stories: sections.flatMap((section) =>
        section.storyIds.map((id) => ({ id, section: section.key, url: null, note: "" })),
      ),
      excluded,
    };
  }

  it("saves the proposed board on the outline and the action rows; a second commit saves its own rows", async () => {
    const proposed: ProposedBoard = {
      sections: [
        { key: "headlines", storyIds: [ids.a, ids.b] },
        { key: "tools", storyIds: [ids.c] },
      ],
      leadStoryId: ids.a,
      repeatsRemoved: [ids.d],
    };

    const first = await commitNativeDraft(
      outline(
        [
          { key: "headlines", storyIds: [ids.a] },
          { key: "tools", storyIds: [ids.c] },
        ],
        [{ id: ids.b, section: "headlines", reason: "", reasonCode: "promo" }],
      ),
      target,
      { ...options, proposed, feedback: [] },
    );
    const second = await commitNativeDraft(
      outline(
        [
          { key: "headlines", storyIds: [ids.a, ids.d] },
          { key: "tools", storyIds: [ids.b, ids.c] },
        ],
        [],
      ),
      target,
      { ...options, proposed, feedback: [{ storyId: ids.b, action: "move", code: "wrong section", text: "a tool" }] },
    );

    const saved = await prisma.approvalOutline.findUniqueOrThrow({ where: { id: first.outlineId } });
    expect(saved.proposed).toEqual(proposed);

    const rowsOf = async (outlineId: bigint) =>
      (await prisma.boardAction.findMany({ where: { outlineId }, orderBy: { id: "asc" } })).map((row) => ({
        issueDate: row.issueDate.toISOString().slice(0, 10),
        storyId: row.storyId,
        action: row.action,
        from: [row.fromSection, row.fromPosition],
        to: [row.toSection, row.toPosition],
        reason: [row.reasonCode, row.reasonText],
      }));

    expect(await rowsOf(first.outlineId)).toEqual([
      { issueDate: date, storyId: ids.b, action: "exclude", from: ["headlines", 2], to: [null, null], reason: ["promo", null] },
    ]);
    expect(await rowsOf(second.outlineId)).toEqual([
      { issueDate: date, storyId: ids.b, action: "move", from: ["headlines", 2], to: ["tools", 1], reason: ["wrong section", "a tool"] },
      { issueDate: date, storyId: ids.d, action: "restore_repeat", from: [null, null], to: ["headlines", 2], reason: [null, null] },
    ]);
  });

  it("refuses an action the CHECK constraint does not know", async () => {
    await expect(
      prisma.boardAction.create({ data: { outlineId: BigInt(0), issueDate: day, action: "click" } }),
    ).rejects.toThrow();
  });
});
