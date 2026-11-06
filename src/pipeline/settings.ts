import type { Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";

// Stage owners, deadlines and thresholds (rule R1). Callers validate the JSON shape they expect.
export async function readSetting(key: string): Promise<Prisma.JsonValue | null> {
  const row = await prisma.pipelineSetting.findUnique({ where: { key } });
  return row?.value ?? null;
}

export function writeSetting(key: string, value: Prisma.InputJsonValue) {
  return prisma.pipelineSetting.upsert({
    where: { key },
    create: { key, value },
    update: { value },
  });
}
