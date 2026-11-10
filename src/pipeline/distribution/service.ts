import { createGhlDistributionService, GHL_SERVICE } from "@/src/pipeline/distribution/ghl";
import type { SideEffectRecord } from "@/src/pipeline/side-effects";

/**
 * The distribution service (GLOSSARY.md): the outside service that sends the issue email. The app only creates
 * an email there when the owner stages a draft for sending (#149, ADR 0005); the owner sends it by hand.
 */
export interface DistributionService {
  /** Stored in staged_versions.service. */
  key: string;
  /** Shown to the owner, e.g. in "Open in GHL". */
  displayName: string;
  /**
   * Creates a new email in the service. It never changes or deletes an existing one. `recorded` outside
   * production: nothing reached the service and the ref is a stand-in. `signal` stops a call that is still
   * running, so a caller that gave up does not leave an email behind.
   */
  createEmail(input: { name: string; html: string; signal?: AbortSignal }): Promise<{ ref: string; url: string | null; mode: "sent" | "recorded" }>;
}

export interface DistributionServiceOptions {
  /** Gets each call outside production (see side-effects). */
  record?: (entry: SideEffectRecord) => void | Promise<void>;
  fetch?: typeof fetch;
}

const DISPLAY_NAMES: Record<string, string> = { [GHL_SERVICE.key]: GHL_SERVICE.displayName };

/** The owner's name for the service a staged version was made in (staged_versions.service). */
export function distributionServiceName(key: string): string {
  return DISPLAY_NAMES[key] ?? key;
}

/** The one place that picks the service. A different service is one new implementation and a change here. */
export function distributionServiceFromEnv(
  env: Record<string, string | undefined> = process.env,
  options: DistributionServiceOptions = {},
): DistributionService {
  return createGhlDistributionService(env, options);
}
