import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";

import { canonicalUri, signAwsRequest } from "@/src/pipeline/draft/image/sigv4";

// AWS's published example credentials, not real ones.
const EXAMPLE_CREDENTIALS = {
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
};

describe("signAwsRequest", () => {
  // The "PUT Object" example from AWS's S3 docs: "Signature Calculations for the Authorization Header:
  // Transferring Payload in a Single Chunk (AWS Signature Version 4)".
  it("matches AWS's documented S3 PUT example", () => {
    const payloadHash = createHash("sha256").update("Welcome to Amazon S3.").digest("hex");

    const signed = signAwsRequest({
      method: "PUT",
      url: new URL("https://examplebucket.s3.amazonaws.com/test$file.text"),
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash,
      region: "us-east-1",
      service: "s3",
      now: new Date("2013-05-24T00:00:00Z"),
      credentials: EXAMPLE_CREDENTIALS,
    });

    expect(payloadHash).toBe("44ce7dd67c959e0d3524ffac1771dfbba87d2b6b4b4e99e42034a8b803f8b072");
    expect(signed["x-amz-date"]).toBe("20130524T000000Z");
    expect(signed["x-amz-content-sha256"]).toBe(payloadHash);
    expect(signed.authorization).toBe(
      "AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, " +
        "SignedHeaders=date;host;x-amz-content-sha256;x-amz-date;x-amz-storage-class, " +
        "Signature=98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd",
    );
    // fetch sets Host from the URL, so the signer must not hand it back as a header to send.
    expect(signed.host).toBeUndefined();
  });
});

describe("canonicalUri", () => {
  it("encodes each path segment once and keeps the slashes", () => {
    expect(canonicalUri("/newsletter-dev/2026-11-09-ab12.jpg")).toBe("/newsletter-dev/2026-11-09-ab12.jpg");
    expect(canonicalUri("/a b/c$d!'()*~.jpg")).toBe("/a%20b/c%24d%21%27%28%29%2A~.jpg");
  });
});
