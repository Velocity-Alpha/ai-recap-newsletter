import { describe, expect, it, vi } from "vitest";

vi.mock("@/src/server/prisma", () => ({ prisma: {} }));

import type { PrismaClient } from "@/src/generated/prisma";
import type { PublishEventInput } from "@/src/pipeline/publish/detect-publish";
import { createPrismaPublishStore } from "@/src/pipeline/publish/publish-store";

const EVENT: PublishEventInput = {
  mode: "native",
  outcome: "would_publish",
  gmailMessageId: "m1",
  receivedAt: null,
  issueId: 268,
  subject: null,
  title: null,
  storyIds: [],
  contentJson: null,
  problems: [],
  draftId: 41,
};

describe("publish store", () => {
  it("stores the sent draft's id on the publish event", async () => {
    const createMany = vi.fn<(args: { data: Array<{ draftId: unknown }> }) => Promise<{ count: number }>>(async () => ({ count: 1 }));
    const store = createPrismaPublishStore({ publishEvent: { createMany } } as unknown as PrismaClient);

    await store.recordEvent(EVENT);
    await store.recordEvent({ ...EVENT, gmailMessageId: "m2", draftId: null });

    expect(createMany.mock.calls.map(([args]) => args.data[0].draftId)).toEqual([
      BigInt(41),
      null,
    ]);
  });
});
