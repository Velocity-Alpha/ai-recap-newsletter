import type { DistributionService, DistributionServiceOptions } from "@/src/pipeline/distribution/service";
import { createEmailTemplate } from "@/src/pipeline/draft/ghl-template";

export const GHL_SERVICE = { key: "ghl", displayName: "GHL" } as const;

/**
 * GHL as the distribution service: an email is a new GHL email template (ghl-template.ts). The calls go through
 * side-effects, so outside production they are recorded and nothing reaches GHL.
 */
export function createGhlDistributionService(
  env: Record<string, string | undefined>,
  options: DistributionServiceOptions = {},
): DistributionService {
  return {
    ...GHL_SERVICE,
    async createEmail({ name, html, signal }) {
      const template = await createEmailTemplate({ name, html }, { env, fetch: options.fetch, record: options.record, signal });
      return { ref: template.templateId, url: template.previewUrl ?? null, mode: template.mode };
    },
  };
}
