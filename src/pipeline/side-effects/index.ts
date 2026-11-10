/**
 * The one door to the outside world for pipeline jobs (#49).
 *
 * Every call to the distribution service, S3, or the AI Recap Review Telegram group goes through `run()`. Only
 * production (`APP_ENV=production`, exact match) sends. Everywhere else the payload is recorded and `dryRun()`
 * gives the result, so previews and local runs can never touch the distribution service, production S3, or the
 * review group.
 *
 * S3 is the one exception to "record only": outside production a job may upload, but only under the
 * non-production prefix (`assertS3KeyAllowed`), so a test draft can still show its image.
 */

export type SideEffectTarget = "distribution" | "s3" | "review_group";

/** What a non-production run would have sent. Never put secrets in a payload. */
export interface SideEffectRecord {
  target: SideEffectTarget;
  action: string;
  payload: unknown;
}

export interface SideEffectCall<T> {
  target: SideEffectTarget;
  action: string;
  payload: unknown;
  /** The real call. Runs only in production. */
  send: () => Promise<T>;
  /** The stand-in result outside production. */
  dryRun: () => T;
}

export type SideEffectOutcome<T> = { mode: "sent"; value: T } | { mode: "recorded"; value: T };

export interface SideEffects {
  /** True only in production. */
  readonly live: boolean;
  run<T>(call: SideEffectCall<T>): Promise<SideEffectOutcome<T>>;
}

export interface CreateSideEffectsOptions {
  appEnv: string | undefined;
  /** Where non-production calls are recorded. Defaults to a structured log line. */
  record?: (entry: SideEffectRecord) => void | Promise<void>;
}

export function isProduction(appEnv: string | undefined): boolean {
  return appEnv === "production";
}

function logRecord(entry: SideEffectRecord): void {
  console.info(JSON.stringify({ event: "side_effect_recorded", ...entry }));
}

export function createSideEffects(options: CreateSideEffectsOptions): SideEffects {
  const live = isProduction(options.appEnv);
  const record = options.record ?? logRecord;
  return {
    live,
    async run<T>(call: SideEffectCall<T>): Promise<SideEffectOutcome<T>> {
      if (live) return { mode: "sent", value: await call.send() };
      await record({ target: call.target, action: call.action, payload: call.payload });
      return { mode: "recorded", value: call.dryRun() };
    },
  };
}

/** A recorded payload for the run log: each `html` string becomes its length, so the log stays small. */
export function withoutHtml(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(withoutHtml);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        key === "html" && typeof item === "string" ? `[${item.length} characters of HTML]` : withoutHtml(item),
      ]),
    );
  }
  return value;
}

const PRODUCTION_S3_PREFIX = "newsletter/";
const NON_PRODUCTION_S3_PREFIX = "newsletter-dev/";

/** Featured images live under `newsletter/` in production and `newsletter-dev/` everywhere else. */
export function s3KeyPrefix(appEnv: string | undefined): string {
  return isProduction(appEnv) ? PRODUCTION_S3_PREFIX : NON_PRODUCTION_S3_PREFIX;
}

/** Throws unless the key sits under this environment's prefix. */
export function assertS3KeyAllowed(appEnv: string | undefined, key: string): void {
  const prefix = s3KeyPrefix(appEnv);
  if (!key.startsWith(prefix)) {
    throw new Error(`S3 key "${key}" is not allowed here. Keys must start with "${prefix}".`);
  }
}
