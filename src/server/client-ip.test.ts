import { describe, expect, it } from "vitest";

import { getClientIp } from "@/src/server/client-ip";

function requestWith(headers: Record<string, string>) {
  return new Request("http://localhost/api/test", { headers });
}

describe("getClientIp", () => {
  it("prefers the address Netlify's edge saw", () => {
    const request = requestWith({
      "x-nf-client-connection-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });

    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it("falls back to the first x-forwarded-for entry", () => {
    expect(getClientIp(requestWith({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("returns null when no address header is present", () => {
    expect(getClientIp(requestWith({}))).toBeNull();
  });
});
