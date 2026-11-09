import { describe, expect, it } from "vitest";

import { refuseCrossOriginWrite } from "@/src/server/same-origin";

const SITE = "https://airecap.news";

function request(method: string, headers: Record<string, string> = {}, path = "/api/newsletters/commit") {
  return new Request(`${SITE}${path}`, { method, headers });
}

const json = { "content-type": "application/json" };

describe("refuseCrossOriginWrite", () => {
  it("allows a write from this site's own origin", () => {
    expect(refuseCrossOriginWrite(request("POST", { origin: SITE, ...json }))).toBeNull();
  });

  it.each([
    ["another site", "https://example.com"],
    ["a sibling subdomain", "https://sites.airecap.news"],
    ["a subdomain of this site", "https://www.airecap.news"],
    ["the same host over http", "http://airecap.news"],
    ["the same host on another port", "https://airecap.news:8443"],
    ["an opaque origin", "null"],
  ])("refuses a write whose Origin is %s", async (_label, origin) => {
    const response = refuseCrossOriginWrite(request("POST", { origin, ...json }));

    expect(response?.status).toBe(403);
    expect(await response?.json()).toEqual({ error: "Cross-origin request refused." });
  });

  it("allows a write without Origin when Sec-Fetch-Site says same-origin", () => {
    expect(refuseCrossOriginWrite(request("POST", { "sec-fetch-site": "same-origin", ...json }))).toBeNull();
  });

  it.each(["same-site", "cross-site", "none"])("refuses a write without Origin when Sec-Fetch-Site is %s", (site) => {
    expect(refuseCrossOriginWrite(request("POST", { "sec-fetch-site": site, ...json }))?.status).toBe(403);
  });

  it("allows a write with neither header, which only non-browser clients send", () => {
    expect(refuseCrossOriginWrite(request("POST", json))).toBeNull();
  });

  it.each(["GET", "HEAD", "OPTIONS"])("leaves %s requests alone", (method) => {
    expect(refuseCrossOriginWrite(request(method, { origin: "https://sites.airecap.news" }))).toBeNull();
  });

  it.each(["PUT", "PATCH", "DELETE"])("checks %s like POST", (method) => {
    expect(refuseCrossOriginWrite(request(method, { origin: "https://sites.airecap.news", ...json }))?.status).toBe(403);
  });

  describe("with requireJson", () => {
    it.each(["application/json", "application/json; charset=utf-8", "Application/JSON"])(
      "allows a %s body",
      (contentType) => {
        const write = request("POST", { origin: SITE, "content-type": contentType });

        expect(refuseCrossOriginWrite(write, { requireJson: true })).toBeNull();
      },
    );

    it.each([
      ["text/plain", { "content-type": "text/plain;charset=UTF-8" }],
      ["a form", { "content-type": "application/x-www-form-urlencoded" }],
      ["multipart", { "content-type": "multipart/form-data; boundary=x" }],
      ["no content type", {}],
    ])("refuses %s with 415", async (_label, headers: Record<string, string>) => {
      const response = refuseCrossOriginWrite(request("POST", { origin: SITE, ...headers }), { requireJson: true });

      expect(response?.status).toBe(415);
      expect(await response?.json()).toEqual({ error: "Content-Type must be application/json." });
    });

    it("leaves GET requests alone", () => {
      expect(refuseCrossOriginWrite(request("GET", {}), { requireJson: true })).toBeNull();
    });

    it("checks the origin first", () => {
      const write = request("POST", { origin: "https://sites.airecap.news", "content-type": "text/plain" });

      expect(refuseCrossOriginWrite(write, { requireJson: true })?.status).toBe(403);
    });
  });
});
