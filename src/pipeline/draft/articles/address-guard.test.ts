import { describe, expect, it } from "vitest";

import { assertPublicUrl, createGuardedLookup, isPrivateAddress, RefusedUrlError } from "@/src/pipeline/draft/articles/address-guard";

describe("isPrivateAddress", () => {
  it.each([
    "127.0.0.1",
    "127.10.0.3",
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "fe80::1",
    "fd00:ec2::254",
    "fc00::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "64:ff9b::a9fe:a9fe",
  ])("treats %s as private", (address) => {
    expect(isPrivateAddress(address)).toBe(true);
  });

  it.each(["93.184.216.34", "140.82.112.3", "172.32.0.1", "100.128.0.1", "2001:4998:60:807::1", "::ffff:8.8.8.8"])(
    "treats %s as public",
    (address) => {
      expect(isPrivateAddress(address)).toBe(false);
    },
  );

  it("treats anything that is not an IP address as private", () => {
    expect(isPrivateAddress("not-an-ip")).toBe(true);
  });
});

describe("assertPublicUrl", () => {
  it("accepts public http and https links", () => {
    expect(assertPublicUrl("https://news.example.com/a?b=1").href).toBe("https://news.example.com/a?b=1");
    expect(assertPublicUrl("http://93.184.216.34/page").hostname).toBe("93.184.216.34");
  });

  it.each([
    ["ftp://news.example.com/file", "only http and https"],
    ["file:///etc/passwd", "only http and https"],
    ["javascript:alert(1)", "only http and https"],
    ["not a url", "not a valid URL"],
    ["https://user:secret@news.example.com/", "user name or password"],
    ["http://localhost:3000/", "local"],
    ["http://app.localhost/", "local"],
    ["http://printer.local/", "local"],
    ["http://metadata.google.internal/computeMetadata/v1/", "local"],
    ["http://intranet/", "local"],
    ["http://127.0.0.1:9001/2018-06-01/runtime/invocation/next", "private address"],
    ["http://169.254.169.254/latest/meta-data/", "private address"],
    ["http://10.0.0.5/", "private address"],
    ["http://[::1]/", "private address"],
    ["http://[fd00:ec2::254]/", "private address"],
    ["http://[::ffff:127.0.0.1]/", "private address"],
    ["http://2130706433/", "private address"],
    ["http://0x7f.1/", "private address"],
  ])("refuses %s", (url, reason) => {
    expect(() => assertPublicUrl(url)).toThrow(RefusedUrlError);
    expect(() => assertPublicUrl(url)).toThrow(reason);
  });
});

describe("createGuardedLookup", () => {
  type Result = { error: Error | null; address?: unknown; family?: number };

  function lookupWith(addresses: Array<{ address: string; family: number }>) {
    const lookup = createGuardedLookup((_hostname, callback) => callback(null, addresses));
    const call = (all: boolean) =>
      new Promise<Result>((resolve) =>
        lookup("news.example.com", { all }, (error: Error | null, address?: unknown, family?: number) => resolve({ error, address, family })),
      );
    return call;
  }

  it("passes public addresses through, in both callback styles", async () => {
    const call = lookupWith([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1::1", family: 6 },
    ]);
    await expect(call(false)).resolves.toEqual({ error: null, address: "93.184.216.34", family: 4 });
    await expect(call(true)).resolves.toMatchObject({ error: null, address: [{ address: "93.184.216.34", family: 4 }, { address: "2606:2800:220:1::1", family: 6 }] });
  });

  it("refuses a name that resolves to a private address, even when another address is public", async () => {
    const result = await lookupWith([
      { address: "93.184.216.34", family: 4 },
      { address: "10.0.0.7", family: 4 },
    ])(false);
    expect(result.error).toBeInstanceOf(RefusedUrlError);
    expect(result.error?.message).toContain("news.example.com resolves to a private address");
  });

  it("passes resolver errors on", async () => {
    const lookup = createGuardedLookup((_hostname, callback) => callback(new Error("ENOTFOUND"), []));
    const result = await new Promise<Result>((resolve) => lookup("gone.example.com", {}, (error: Error | null) => resolve({ error })));
    expect(result.error?.message).toBe("ENOTFOUND");
  });
});
