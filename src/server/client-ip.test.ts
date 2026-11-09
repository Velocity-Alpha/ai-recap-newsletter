import { afterEach, describe, expect, it, vi } from "vitest";

import { getClientIp, rateLimitIpIdentifier } from "@/src/server/client-ip";

function requestWith(headers: Record<string, string>) {
  return new Request("http://localhost/api/test", { headers });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getClientIp", () => {
  it("uses the address Netlify's edge saw", () => {
    vi.stubEnv("APP_ENV", "production");
    const request = requestWith({
      "x-nf-client-connection-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 203.0.113.7",
    });

    expect(getClientIp(request)).toBe("203.0.113.7");
  });

  it.each(["production", "preview"])("ignores x-forwarded-for when APP_ENV is %s", (appEnv) => {
    vi.stubEnv("APP_ENV", appEnv);

    expect(getClientIp(requestWith({ "x-forwarded-for": "198.51.100.1" }))).toBeNull();
  });

  it("falls back to the first x-forwarded-for entry in local development", () => {
    vi.stubEnv("APP_ENV", "development");

    expect(getClientIp(requestWith({ "x-forwarded-for": " 198.51.100.1 , 10.0.0.1" }))).toBe("198.51.100.1");
  });

  it("returns null when no address header is present", () => {
    vi.stubEnv("APP_ENV", "development");

    expect(getClientIp(requestWith({}))).toBeNull();
  });
});

describe("rateLimitIpIdentifier", () => {
  it("keeps IPv4 addresses whole", () => {
    expect(rateLimitIpIdentifier("203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitIpIdentifier(" 203.0.113.7 ")).toBe("203.0.113.7");
  });

  it("groups IPv6 addresses by their /64", () => {
    const a = rateLimitIpIdentifier("2001:db8:aaaa:1:1111:2222:3333:4444");
    const b = rateLimitIpIdentifier("2001:0DB8:AAAA:0001::9");
    const otherNetwork = rateLimitIpIdentifier("2001:db8:aaaa:2::1");

    expect(a).toBe("2001:db8:aaaa:1::/64");
    expect(b).toBe(a);
    expect(otherNetwork).not.toBe(a);
  });

  it("expands :: wherever it appears", () => {
    expect(rateLimitIpIdentifier("::1")).toBe("0:0:0:0::/64");
    expect(rateLimitIpIdentifier("2001:db8::")).toBe("2001:db8:0:0::/64");
    expect(rateLimitIpIdentifier("fe80::1%eth0")).toBe("fe80:0:0:0::/64");
    expect(rateLimitIpIdentifier("[2001:db8::1]")).toBe("2001:db8:0:0::/64");
  });

  it("treats IPv4-mapped IPv6 addresses as IPv4", () => {
    expect(rateLimitIpIdentifier("::ffff:203.0.113.7")).toBe("203.0.113.7");
    expect(rateLimitIpIdentifier("::ffff:cb00:7107")).toBe("203.0.113.7");
  });

  it("keeps unparseable values as they are", () => {
    expect(rateLimitIpIdentifier("not-an-ip")).toBe("not-an-ip");
    expect(rateLimitIpIdentifier("1:2:3:4:5:6:7:8:9")).toBe("1:2:3:4:5:6:7:8:9");
    expect(rateLimitIpIdentifier("1::2::3")).toBe("1::2::3");
  });

  it("uses one shared bucket when the address is unknown", () => {
    expect(rateLimitIpIdentifier(null)).toBe("unknown");
    expect(rateLimitIpIdentifier("  ")).toBe("unknown");
  });
});
