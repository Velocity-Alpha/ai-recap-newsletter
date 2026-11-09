import { randomBytes } from "node:crypto";

import { withRetries } from "@/src/pipeline/draft/image/retry";
import { sha256Hex, signAwsRequest } from "@/src/pipeline/draft/image/sigv4";
import { assertS3KeyAllowed, s3KeyPrefix } from "@/src/pipeline/side-effects";

/**
 * Uploads a featured image to the public assets bucket. S3 is the side-effects module's one exception to
 * "record only": outside production the upload still happens, so a test draft shows its image, but only under
 * `newsletter-dev/` (`s3KeyPrefix` + `assertS3KeyAllowed`).
 */

export const UPLOAD_TIMEOUT_MS = 30_000;
export const UPLOAD_RETRIES = 2;

export interface S3Config {
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  bucket: string;
}

export interface UploadImageOptions {
  /** Defaults to APP_ENV. Picks the key prefix. */
  appEnv?: string;
  /** Defaults to the S3_* env variables. */
  s3?: S3Config;
  fetch?: typeof fetch;
  randomId?: () => string;
  now?: () => Date;
  retryDelayMs?: number;
}

const ENV_NAMES = {
  accessKeyId: "S3_ACCESS_KEY_ID",
  secretAccessKey: "S3_SECRET_ACCESS_KEY",
  region: "S3_REGION",
  bucket: "S3_BUCKET",
} as const;

export function s3ConfigFromEnv(env: Record<string, string | undefined> = process.env): S3Config {
  const missing = Object.values(ENV_NAMES).filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`S3 is not configured: ${missing.join(", ")} not set.`);
  return {
    accessKeyId: env[ENV_NAMES.accessKeyId]!.trim(),
    secretAccessKey: env[ENV_NAMES.secretAccessKey]!.trim(),
    region: env[ENV_NAMES.region]!.trim(),
    bucket: env[ENV_NAMES.bucket]!.trim(),
  };
}

function isIssueDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

/** `<prefix><issue date>-<random id>.jpg`, for example `newsletter-dev/2026-11-09-3f9c2a1b7d4e6f80.jpg`. */
export function imageKey(appEnv: string | undefined, issueDate: string, randomId: string): string {
  if (!isIssueDate(issueDate)) throw new Error(`"${issueDate}" is not an issue date (YYYY-MM-DD).`);
  if (!/^[a-z0-9]+$/i.test(randomId)) throw new Error("The image's random id must be letters and digits.");
  const key = `${s3KeyPrefix(appEnv)}${issueDate}-${randomId}.jpg`;
  assertS3KeyAllowed(appEnv, key);
  return key;
}

/** The URL form n8n stores in `feature_image_url`, and the one `next.config.mjs` allows. */
export function publicImageUrl(bucket: string, key: string): string {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

function s3ErrorCode(body: string): string | null {
  return /<Code>([^<]+)<\/Code>/.exec(body)?.[1] ?? null;
}

/** Uploads a JPEG and returns its public URL. Tries 3 times (2 retries) with the same key. */
export async function uploadImage(
  bytes: Uint8Array,
  issueDate: string,
  options: UploadImageOptions = {},
): Promise<string> {
  if (bytes.byteLength === 0) throw new Error("The image is empty.");
  const appEnv = options.appEnv ?? process.env.APP_ENV;
  const key = imageKey(appEnv, issueDate, (options.randomId ?? (() => randomBytes(8).toString("hex")))());
  const s3 = options.s3 ?? s3ConfigFromEnv();
  const fetchImpl = options.fetch ?? fetch;
  const url = new URL(`https://${s3.bucket}.s3.${s3.region}.amazonaws.com/${key}`);
  const payloadHash = sha256Hex(bytes);

  await withRetries(
    "Upload",
    async () => {
      const headers = signAwsRequest({
        method: "PUT",
        url,
        headers: { "content-type": "image/jpeg" },
        payloadHash,
        region: s3.region,
        service: "s3",
        now: (options.now ?? (() => new Date()))(),
        credentials: { accessKeyId: s3.accessKeyId, secretAccessKey: s3.secretAccessKey },
      });
      const response = await fetchImpl(url.toString(), {
        method: "PUT",
        headers,
        body: bytes as BodyInit,
        signal: AbortSignal.timeout(UPLOAD_TIMEOUT_MS),
      });
      if (!response.ok) {
        const code = s3ErrorCode(await response.text().catch(() => ""));
        throw new Error(`S3 returned HTTP ${response.status}${code ? ` (${code})` : ""}.`);
      }
    },
    { retries: UPLOAD_RETRIES, delayMs: options.retryDelayMs ?? 2_000 },
  );

  return publicImageUrl(s3.bucket, key);
}
