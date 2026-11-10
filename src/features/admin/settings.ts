import { prisma } from "@/src/server/prisma";

export type SettingRow = { key: string; value: string; updatedAt: Date };

/** Every pipeline_settings row for /admin/settings. */
export async function readSettings(): Promise<{ rows: SettingRow[] }> {
  const settings = await prisma.pipelineSetting.findMany({ orderBy: { key: "asc" } });
  return {
    rows: settings.map((setting) => ({
      key: setting.key,
      value: JSON.stringify(setting.value),
      updatedAt: setting.updatedAt,
    })),
  };
}
