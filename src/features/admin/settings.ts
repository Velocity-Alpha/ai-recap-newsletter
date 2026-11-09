import { STAGE_SWITCHES, toStageSwitchView, type StageSwitchView } from "@/src/features/admin/stage-switches";
import { prisma } from "@/src/server/prisma";

export type SettingRow = { key: string; value: string; updatedAt: Date };

/** Every pipeline_settings row for /admin/settings, and the stage switches built from the same rows. */
export async function readSettings(): Promise<{ rows: SettingRow[]; stageSwitches: StageSwitchView[] }> {
  const settings = await prisma.pipelineSetting.findMany({ orderBy: { key: "asc" } });
  const byKey = new Map(settings.map((setting) => [setting.key, setting]));
  return {
    rows: settings.map((setting) => ({
      key: setting.key,
      value: JSON.stringify(setting.value),
      updatedAt: setting.updatedAt,
    })),
    stageSwitches: STAGE_SWITCHES.map((stage) => toStageSwitchView(stage, byKey.get(stage.key) ?? null)),
  };
}
