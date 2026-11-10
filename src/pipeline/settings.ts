import type { Prisma } from "@/src/generated/prisma";
import { prisma } from "@/src/server/prisma";

// Deadlines, thresholds and the job runner (rule R1). Callers validate the JSON shape they expect.
// Never store secrets (tokens, keys, passwords, URLs with credentials) here: /admin/settings prints every row.
// Secrets belong in env vars.
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
