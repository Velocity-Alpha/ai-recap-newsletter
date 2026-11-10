// Opt-in: runs against a real database and cleans up after itself.
//   PIPELINE_IT=1 DATABASE_URL=<Neon dev branch> npx vitest run src/pipeline/checks/day-facts.integration.test.ts
// The branch needs the skipped_dates migration. The rows sit on a Tuesday after 2099, so no real rows count.
// It refuses to run when DATABASE_URL points at the same Neon endpoint as PRODUCTION_DATABASE_URL.
import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { Prisma } from "@/src/generated/prisma";
import { readDayFacts } from "@/src/pipeline/checks/day-facts";
import { newYorkTime, shiftDate } from "@/src/pipeline/checks/schedule";
import { prisma } from "@/src/server/prisma";

function endpoint(url: string | undefined) {
  return url ? new URL(url).hostname.split(".")[0].replace(/-pooler$/, "") : null;
}

const enabled = process.env.PIPELINE_IT === "1";
if (enabled && endpoint(process.env.DATABASE_URL) === endpoint(process.env.PRODUCTION_DATABASE_URL)) {
  throw new Error("Refusing to run the day facts integration test against production.");
}

describe.skipIf(!enabled)("readDayFacts on a real database", () => {
  const tag = `it-${randomUUID()}`;
  // A random Tuesday from 2099-03-03 on, so parallel runs do not share a date.
  const date = shiftDate("2099-03-03", 7 * Math.floor(Math.random() * 400));
  const day = new Date(`${date}T00:00:00Z`);
  const ids = { run: 0n, issue: 0n };

  function story(n: number, source: string, createdAt: Date, extra: Partial<Prisma.StoryCreateManyInput> = {}) {
    return { guid: `${tag}-${n}`, source, headline: "Synthetic headline", createdAt, updatedAt: createdAt, ...extra };
  }

  beforeAll(async () => {
    await prisma.story.createMany({
      data: [
        story(1, `${tag}-a`, newYorkTime(date, "09:56"), { queuedForPublicationDate: day, updatedAt: newYorkTime(date, "11:50") }),
        story(2, `${tag}-a`, newYorkTime(date, "09:57"), { queuedForPublicationDate: day, updatedAt: newYorkTime(date, "11:52") }),
        // Still the New York day, though already the next day in UTC.
        story(3, `${tag}-a`, newYorkTime(date, "23:30")),
        story(4, `${tag}-b`, newYorkTime(date, "09:58")),
        // The next New York day: not counted.
        story(5, `${tag}-b`, newYorkTime(shiftDate(date, 1), "00:30")),
        // The same weekday a week before: history.
        story(6, `${tag}-a`, newYorkTime(shiftDate(date, -7), "09:56")),
      ],
    });
    const run = await prisma.pipelineRun.create({
      data: { job: "ingest-stories", trigger: "schedule", status: "succeeded", startedAt: newYorkTime(date, "09:55") },
    });
    ids.run = run.id;
    const issue = await prisma.issue.create({
      data: {
        title: `Synthetic issue ${tag}`,
        issueDate: day,
        html: "<p>Synthetic</p>",
        createdAt: newYorkTime(date, "11:48"),
        publishedAt: newYorkTime(date, "12:31"),
      },
    });
    ids.issue = issue.id;
    await prisma.skippedDate.create({ data: { date: day, note: tag, createdBy: "integration-test" } });
  });

  afterAll(async () => {
    await prisma.story.deleteMany({ where: { guid: { startsWith: tag } } });
    if (ids.run) await prisma.pipelineRun.delete({ where: { id: ids.run } });
    if (ids.issue) await prisma.issue.delete({ where: { id: ids.issue } });
    await prisma.skippedDate.deleteMany({ where: { date: day, note: tag } });
  });

  it("reads one New York date from the real tables", async () => {
    const facts = await readDayFacts(date);

    expect(facts).toMatchObject({
      date,
      weekday: "Tue",
      skipped: { note: tag },
      ingestRun: { id: ids.run.toString(), status: "succeeded", startedAt: newYorkTime(date, "09:55") },
      storiesBySource: { [`${tag}-a`]: 3, [`${tag}-b`]: 1 },
      storyTotal: 4,
      weekdayTotals: [1],
      queuedStories: 2,
      committed: true,
      // The draft row is older than the queued stories' last update.
      commitTime: newYorkTime(date, "11:48"),
      draftsMade: 1,
      draftReady: true,
      issue: { id: ids.issue.toString(), title: `Synthetic issue ${tag}`, publishedAt: newYorkTime(date, "12:31") },
      warnings: [],
    });
    expect(facts.issue?.slug).toBeTruthy();
  });
});
