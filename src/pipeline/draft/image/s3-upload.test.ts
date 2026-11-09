import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";

import { imageKey, publicImageUrl, s3ConfigFromEnv, uploadImage, type S3Config } from "@/src/pipeline/draft/image/s3-upload";
import * as sideEffects from "@/src/pipeline/side-effects";

vi.mock("@/src/pipeline/side-effects", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/pipeline/side-effects")>();
  return { ...actual, assertS3KeyAllowed: vi.fn(actual.assertS3KeyAllowed) };
});

const S3: S3Config = {
  accessKeyId: "AKIDEXAMPLE",
  secretAccessKey: "test-secret-key",
  region: "us-east-1",
  bucket: "example-bucket",
};
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const NOW = () => new Date("2026-11-09T12:34:56.789Z");

function fakeFetch(...responses: Array<Response | Error>) {
  return vi.fn<typeof fetch>(async () => {
    const next = responses.shift() ?? new Response(null, { status: 200 });
    if (next instanceof Error) throw next;
    return next;
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("imageKey", () => {
  it("is <prefix><issue date>-<random id>.jpg, with the prefix from the side-effects module", () => {
    expect(imageKey("preview", "2026-11-09", "ab12cd34")).toBe("newsletter-dev/2026-11-09-ab12cd34.jpg");
    expect(imageKey(undefined, "2026-11-09", "ab12cd34")).toBe("newsletter-dev/2026-11-09-ab12cd34.jpg");
    expect(imageKey("production", "2026-11-09", "ab12cd34")).toBe("newsletter/2026-11-09-ab12cd34.jpg");
  });

  it("refuses a date or id that could change the path", () => {
    expect(() => imageKey("preview", "../newsletter/2026-11-09", "ab12")).toThrow("issue date");
    expect(() => imageKey("preview", "2026-13-40", "ab12")).toThrow("issue date");
    expect(() => imageKey("preview", "2026-11-09", "../x")).toThrow("random id");
  });
});

describe("publicImageUrl", () => {
  it("uses the URL form n8n stores (and the site allows)", () => {
    expect(publicImageUrl("velocity-alpha-public-assets", "newsletter/2026-11-09-ab12.jpg")).toBe(
      "https://velocity-alpha-public-assets.s3.amazonaws.com/newsletter/2026-11-09-ab12.jpg",
    );
  });
});

describe("s3ConfigFromEnv", () => {
  it("reads the four S3 variables and names any that are missing", () => {
    expect(
      s3ConfigFromEnv({ S3_ACCESS_KEY_ID: "a", S3_SECRET_ACCESS_KEY: "b", S3_REGION: "us-east-1", S3_BUCKET: "c" }),
    ).toEqual({ accessKeyId: "a", secretAccessKey: "b", region: "us-east-1", bucket: "c" });
    expect(() => s3ConfigFromEnv({ S3_ACCESS_KEY_ID: "a", S3_REGION: "" })).toThrow(
      "S3 is not configured: S3_SECRET_ACCESS_KEY, S3_REGION, S3_BUCKET not set.",
    );
  });
});

describe("uploadImage", () => {
  it("PUTs the JPEG with a SigV4 signature under the non-production prefix and returns the public URL", async () => {
    const fetchMock = fakeFetch(new Response(null, { status: 200 }));

    const url = await uploadImage(JPEG, "2026-11-09", {
      appEnv: "preview",
      s3: S3,
      fetch: fetchMock,
      randomId: () => "ab12cd34",
      now: NOW,
    });

    expect(url).toBe("https://example-bucket.s3.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [target, init] = fetchMock.mock.calls[0];
    expect(target).toBe("https://example-bucket.s3.us-east-1.amazonaws.com/newsletter-dev/2026-11-09-ab12cd34.jpg");
    expect(init?.method).toBe("PUT");
    expect(init?.body).toBe(JPEG);
    const headers = init?.headers as Record<string, string>;
    const payloadHash = createHash("sha256").update(JPEG).digest("hex");
    expect(headers["content-type"]).toBe("image/jpeg");
    expect(headers["x-amz-date"]).toBe("20261109T123456Z");
    expect(headers["x-amz-content-sha256"]).toBe(payloadHash);
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/20261109\/us-east-1\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
    expect(JSON.stringify(headers)).not.toContain(S3.secretAccessKey);
    expect(sideEffects.assertS3KeyAllowed).toHaveBeenCalledWith("preview", "newsletter-dev/2026-11-09-ab12cd34.jpg");
  });

  it("uses the production prefix only in production", async () => {
    const fetchMock = fakeFetch();
    const url = await uploadImage(JPEG, "2026-11-09", {
      appEnv: "production",
      s3: S3,
      fetch: fetchMock,
      randomId: () => "ab12cd34",
    });
    expect(url).toBe("https://example-bucket.s3.amazonaws.com/newsletter/2026-11-09-ab12cd34.jpg");
  });

  it("defaults to APP_ENV and the S3 env variables, and a random 16-character id", async () => {
    vi.stubEnv("APP_ENV", "development");
    vi.stubEnv("S3_ACCESS_KEY_ID", "AKIDENV");
    vi.stubEnv("S3_SECRET_ACCESS_KEY", "env-secret");
    vi.stubEnv("S3_REGION", "us-east-1");
    vi.stubEnv("S3_BUCKET", "env-bucket");
    const fetchMock = fakeFetch();

    const url = await uploadImage(JPEG, "2026-11-09", { fetch: fetchMock });

    expect(url).toMatch(/^https:\/\/env-bucket\.s3\.amazonaws\.com\/newsletter-dev\/2026-11-09-[0-9a-f]{16}\.jpg$/);
  });

  it("refuses an empty image or a bad date before calling S3", async () => {
    const fetchMock = fakeFetch();
    await expect(uploadImage(new Uint8Array(), "2026-11-09", { s3: S3, fetch: fetchMock })).rejects.toThrow("empty");
    await expect(uploadImage(JPEG, "2026-11-9", { s3: S3, fetch: fetchMock })).rejects.toThrow("issue date");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries twice with the same key, then reports S3's error code without secrets", async () => {
    const denied = () =>
      new Response("<Error><Code>AccessDenied</Code><Message>Access Denied</Message></Error>", { status: 403 });
    const fetchMock = fakeFetch(new Error("fetch failed"), denied(), denied());

    const failure = uploadImage(JPEG, "2026-11-09", {
      appEnv: "preview",
      s3: S3,
      fetch: fetchMock,
      randomId: () => "ab12cd34",
      retryDelayMs: 0,
    });

    await expect(failure).rejects.toThrow("Upload failed after 3 attempts: S3 returned HTTP 403 (AccessDenied).");
    await expect(failure).rejects.not.toThrow(S3.secretAccessKey);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(new Set(fetchMock.mock.calls.map(([target]) => target)).size).toBe(1);
  });
});
