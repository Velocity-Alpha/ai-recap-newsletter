import { createHash, createHmac } from "node:crypto";

/**
 * AWS Signature Version 4 for one S3 request, with node:crypto only. A hand-written signer keeps the Netlify
 * function bundle small: the image step makes one PUT, and the AWS SDK would add megabytes for it.
 * Supports what the upload needs: a path, no query string, and a precomputed payload hash.
 */

export interface AwsCredentials {
  accessKeyId: string;
  secretAccessKey: string;
}

export interface SignAwsRequestInput {
  method: string;
  url: URL;
  /** Extra headers to sign and send. Host, x-amz-date and x-amz-content-sha256 are added here. */
  headers: Record<string, string>;
  /** Hex SHA-256 of the body. */
  payloadHash: string;
  region: string;
  service: string;
  now: Date;
  credentials: AwsCredentials;
}

export function sha256Hex(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: string | Buffer, value: string): Buffer {
  return createHmac("sha256", key).update(value).digest();
}

function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

/** AWS's URI encoding of a path, once per segment (S3 does not double-encode). */
export function canonicalUri(path: string): string {
  return path
    .split("/")
    .map((segment) => encodeSegment(decodeURIComponent(segment)))
    .join("/");
}

/** `20261109T120000Z` */
function amzDate(now: Date): string {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** Returns the headers to send: the caller's headers plus x-amz-date, x-amz-content-sha256 and authorization. */
export function signAwsRequest(input: SignAwsRequestInput): Record<string, string> {
  const timestamp = amzDate(input.now);
  const day = timestamp.slice(0, 8);
  const sent: Record<string, string> = {};
  for (const [name, value] of Object.entries(input.headers)) sent[name.toLowerCase()] = value;
  sent["x-amz-date"] = timestamp;
  sent["x-amz-content-sha256"] = input.payloadHash;

  const signed: Record<string, string> = { ...sent, host: input.url.host };
  const names = Object.keys(signed).sort();
  const canonicalHeaders = names.map((name) => `${name}:${signed[name].trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");
  const canonicalRequest = [
    input.method.toUpperCase(),
    canonicalUri(input.url.pathname),
    "",
    canonicalHeaders,
    signedHeaders,
    input.payloadHash,
  ].join("\n");

  const scope = `${day}/${input.region}/${input.service}/aws4_request`;
  const stringToSign = ["AWS4-HMAC-SHA256", timestamp, scope, sha256Hex(canonicalRequest)].join("\n");
  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${input.credentials.secretAccessKey}`, day), input.region), input.service),
    "aws4_request",
  );
  const signature = createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    ...sent,
    authorization:
      `AWS4-HMAC-SHA256 Credential=${input.credentials.accessKeyId}/${scope}, ` +
      `SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}
