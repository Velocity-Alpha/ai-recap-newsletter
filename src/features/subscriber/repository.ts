import type { SubscriberRecord } from "@/features/subscriber/types";
import { normalizeSubscriberEmail } from "@/features/subscriber/identity";
import { prisma } from "@/server/prisma";

type SubscriberRow = {
  id: bigint;
  email: string;
  firstName: string | null;
  status: string;
  source: string;
  subscribedAt: Date;
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

function mapSubscriberRecord(record: SubscriberRow): SubscriberRecord {
  return {
    id: Number(record.id),
    email: record.email,
    firstName: record.firstName,
    status: record.status as SubscriberRecord["status"],
    source: record.source,
    subscribedAt: record.subscribedAt.toISOString(),
    lastSeenAt: record.lastSeenAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    updatedAt: record.updatedAt.toISOString(),
  };
}

export async function findSubscriberByEmail(email: string) {
  const record = await prisma.subscriber.findUnique({
    where: { email: normalizeSubscriberEmail(email) },
  });

  return record ? mapSubscriberRecord(record) : null;
}

export async function findSubscriberById(id: number) {
  const record = await prisma.subscriber.findUnique({
    where: { id: BigInt(id) },
  });

  return record ? mapSubscriberRecord(record) : null;
}

export async function findSubscriberByIdSafely(id: number) {
  try {
    return await findSubscriberById(id);
  } catch {
    return null;
  }
}

export async function upsertSubscriber(input: {
  email: string;
  firstName?: string | null;
  source: string;
  status?: SubscriberRecord["status"];
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const normalizedFirstName = input.firstName?.trim() || null;
  const nextStatus = input.status ?? "active";
  const now = new Date();

  const record = await prisma.$transaction(async (tx) => {
    const existing = await tx.subscriber.findUnique({
      where: { email: normalizedEmail },
    });

    if (!existing) {
      return tx.subscriber.create({
        data: {
          email: normalizedEmail,
          firstName: normalizedFirstName,
          status: nextStatus,
          source: input.source,
          subscribedAt: now,
          lastSeenAt: now,
        },
      });
    }

    return tx.subscriber.update({
      where: { email: normalizedEmail },
      data: {
        status: nextStatus,
        firstName: normalizedFirstName ?? existing.firstName,
        source: existing.source,
        subscribedAt: existing.status === "active" ? existing.subscribedAt : now,
        lastSeenAt: now,
      },
    });
  });

  return mapSubscriberRecord(record);
}

export async function touchSubscriberSeenAt(id: number) {
  await prisma.subscriber.update({
    where: { id: BigInt(id) },
    data: {
      lastSeenAt: new Date(),
    },
  });
}

export async function markSubscriberUnsubscribed(input: {
  email: string;
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const existing = await prisma.subscriber.findUnique({
    where: { email: normalizedEmail },
  });

  if (!existing) {
    return null;
  }

  const record = await prisma.subscriber.update({
    where: { email: normalizedEmail },
    data: {
      status: "unsubscribed",
      lastSeenAt: new Date(),
    },
  });

  return mapSubscriberRecord(record);
}
