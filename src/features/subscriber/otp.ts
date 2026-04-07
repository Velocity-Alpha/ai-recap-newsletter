import crypto from "node:crypto";

import { normalizeSubscriberEmail } from "@/features/subscriber/identity";
import { getSessionSecret } from "@/features/subscriber/signing";
import { prisma } from "@/server/prisma";

const OTP_LENGTH = 6;
const OTP_TTL_MINUTES = 10;

export function createOneTimeCode() {
  const randomNumber = crypto.randomInt(0, 10 ** OTP_LENGTH);
  return randomNumber.toString().padStart(OTP_LENGTH, "0");
}

export function hashOneTimeCode(email: string, code: string) {
  return crypto
    .createHash("sha256")
    .update(`${normalizeSubscriberEmail(email)}:${code}:${getSessionSecret()}`)
    .digest("hex");
}

export function getOtpExpiryDate() {
  return new Date(Date.now() + OTP_TTL_MINUTES * 60 * 1000);
}

export async function storeOneTimeCode(input: {
  email: string;
  code: string;
  requestIp?: string | null;
  requestUserAgent?: string | null;
}) {
  const normalizedEmail = normalizeSubscriberEmail(input.email);
  const codeHash = hashOneTimeCode(normalizedEmail, input.code);

  await prisma.$transaction([
    prisma.authCode.updateMany({
      where: {
        email: normalizedEmail,
        purpose: "sign_in",
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    }),
    prisma.authCode.create({
      data: {
        email: normalizedEmail,
        codeHash,
        purpose: "sign_in",
        expiresAt: getOtpExpiryDate(),
        requestIp: input.requestIp ?? null,
        requestUserAgent: input.requestUserAgent ?? null,
      },
    }),
  ]);
}

export async function consumeOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  return prisma.$transaction(async (tx) => {
    const authCode = await tx.authCode.findFirst({
      where: {
        email: normalizedEmail,
        codeHash,
        purpose: "sign_in",
        consumedAt: null,
        expiresAt: {
          gt: new Date(),
        },
      },
      orderBy: {
        createdAt: "desc",
      },
    });

    if (!authCode) {
      return false;
    }

    const result = await tx.authCode.updateMany({
      where: {
        id: authCode.id,
        consumedAt: null,
      },
      data: {
        consumedAt: new Date(),
      },
    });

    return result.count > 0;
  });
}

export async function deleteOneTimeCode(email: string, code: string) {
  const normalizedEmail = normalizeSubscriberEmail(email);
  const codeHash = hashOneTimeCode(normalizedEmail, code);

  await prisma.authCode.deleteMany({
    where: {
      email: normalizedEmail,
      codeHash,
      purpose: "sign_in",
      consumedAt: null,
    },
  });
}

export async function cleanupExpiredOneTimeCodes() {
  await prisma.authCode.deleteMany({
    where: {
      createdAt: {
        lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      },
    },
  });
}
