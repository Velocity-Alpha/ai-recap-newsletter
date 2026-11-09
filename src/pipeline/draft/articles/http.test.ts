import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { RefusedUrlError, type ResolveAll } from "@/src/pipeline/draft/articles/address-guard";
import { createNodeFetch, fetchText, FetchFailure, HostLimiter, type FetchInit, type FetchLike } from "@/src/pipeline/draft/articles/http";

function page(body: string, init: { status?: number; headers?: Record<string, string> } = {}) {
  return new Response(body, { status: init.status ?? 200, headers: { "content-type": "text/html; charset=utf-8", ...init.headers } });
}

function redirect(location: string, status = 301) {
  return new Response(null, { status, headers: { location } });
}

const options = (fetch: FetchLike, extra: Partial<Parameters<typeof fetchText>[1]> = {}) => ({
  fetch,
  signal: new AbortController().signal,
  maxBytes: 1_000,
  ...extra,
});

describe("fetchText", () => {
  it("follows redirects by hand and returns the final URL, status, type and body", async () => {
    const fetch = vi.fn<FetchLike>(async (url) =>
      url === "http://news.example.com/a" ? redirect("/b") : url === "http://news.example.com/b" ? redirect("https://www.example.com/c", 308) : page("<p>hi</p>"),
    );

    const result = await fetchText("http://news.example.com/a", options(fetch, { headers: { "User-Agent": "test" } }));

    expect(result).toEqual({ status: 200, url: "https://www.example.com/c", contentType: "text/html; charset=utf-8", body: "<p>hi</p>" });
    expect(fetch.mock.calls.map(([url]) => url)).toEqual(["http://news.example.com/a", "http://news.example.com/b", "https://www.example.com/c"]);
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: "GET", redirect: "manual", headers: { "User-Agent": "test" } });
  });

  it("refuses a redirect to a private address before requesting it", async () => {
    const fetch = vi.fn<FetchLike>(async () => redirect("http://169.254.169.254/latest/meta-data/"));

    await expect(fetchText("https://news.example.com/a", options(fetch))).rejects.toBeInstanceOf(RefusedUrlError);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a private link without requesting it", async () => {
    const fetch = vi.fn<FetchLike>();
    await expect(fetchText("http://localhost:9001/", options(fetch))).rejects.toThrow("local host name");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("drops the Authorization header when a redirect leaves the origin", async () => {
    const fetch = vi.fn<FetchLike>(async (url) => (url.startsWith("https://api.example.com") ? redirect("https://cdn.example.net/file") : page("ok")));

    await fetchText("https://api.example.com/readme", options(fetch, { headers: { Authorization: "Bearer secret", Accept: "x" } }));

    expect(fetch.mock.calls[0][1].headers).toMatchObject({ Authorization: "Bearer secret" });
    expect(fetch.mock.calls[1][1].headers).toEqual({ Accept: "x" });
  });

  it("stops after 5 redirects", async () => {
    let hop = 0;
    const fetch = vi.fn<FetchLike>(async () => redirect(`/loop-${(hop += 1)}`));
    await expect(fetchText("https://news.example.com/", options(fetch))).rejects.toThrow("Too many redirects");
    expect(fetch).toHaveBeenCalledTimes(6);
  });

  it("refuses a body over the size cap, by its declared length or as it streams", async () => {
    const declared = vi.fn<FetchLike>(async () => page("x", { headers: { "content-length": "5000" } }));
    await expect(fetchText("https://news.example.com/", options(declared))).rejects.toMatchObject({ kind: "too_large" });

    const streamed = vi.fn<FetchLike>(async () => page("y".repeat(1_500)));
    const error = await fetchText("https://news.example.com/", options(streamed)).catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(FetchFailure);
    expect(error).toMatchObject({ kind: "too_large", message: expect.stringContaining("over the 1 KB cap") });
  });

  it("decodes the declared charset", async () => {
    const latin1 = new Uint8Array([0x63, 0x61, 0x66, 0xe9]); // "café" in ISO-8859-1
    const fetch = vi.fn<FetchLike>(async () => new Response(latin1, { headers: { "content-type": "text/html; charset=iso-8859-1" } }));
    await expect(fetchText("https://news.example.com/", options(fetch))).resolves.toMatchObject({ body: "café" });
  });

  it("retries once after a network error", async () => {
    const fetch = vi
      .fn<FetchLike>()
      .mockRejectedValueOnce(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } }))
      .mockResolvedValueOnce(page("second try"));
    await expect(fetchText("https://news.example.com/", options(fetch))).resolves.toMatchObject({ body: "second try" });

    const down = vi.fn<FetchLike>(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })));
    await expect(fetchText("https://news.example.com/", options(down))).rejects.toMatchObject({ kind: "network", message: "Network error: fetch failed (ECONNREFUSED)." });
    expect(down).toHaveBeenCalledTimes(2);
  });

  it("does not retry when the address guard refused the connection, and says so", async () => {
    const refused = new RefusedUrlError("Refused news.example.com: news.example.com resolves to a private address.");
    const fetch = vi.fn<FetchLike>(async () => Promise.reject(Object.assign(new TypeError("fetch failed"), { cause: refused })));

    await expect(fetchText("https://news.example.com/", options(fetch))).rejects.toBe(refused);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("does not retry once the signal is aborted, and rethrows its reason", async () => {
    const controller = new AbortController();
    const reason = new Error("stop");
    const fetch = vi.fn<FetchLike>(async (_url, init: FetchInit) => {
      controller.abort(reason);
      throw init.signal.reason;
    });
    await expect(fetchText("https://news.example.com/", options(fetch, { signal: controller.signal }))).rejects.toBe(reason);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("refuses a wrong content type before reading the body, and does not retry", async () => {
    const pull = vi.fn();
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull, cancel }, { highWaterMark: 0 });
    const fetch = vi.fn<FetchLike>(async () => new Response(body, { headers: { "content-type": "Application/PDF; name=x" } }));
    const rejectType = vi.fn((type: string) => (type === "text/html" ? null : `Not HTML (${type}).`));

    const error = await fetchText("https://news.example.com/x.pdf", options(fetch, { rejectType })).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(FetchFailure);
    expect(error).toMatchObject({ kind: "wrong_type", message: "Not HTML (application/pdf)." });
    expect(pull).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("leaves the type of an error page alone, so the status is what the caller sees", async () => {
    const fetch = vi.fn<FetchLike>(async () => new Response("{}", { status: 403, headers: { "content-type": "application/json" } }));

    const result = await fetchText("https://news.example.com/", options(fetch, { rejectType: () => "never HTML" }));

    expect(result).toMatchObject({ status: 403, body: "{}" });
  });

  it("calls onStart only once the host slot is free, just before each request", async () => {
    const limiter = new HostLimiter(1);
    const signal = new AbortController().signal;
    let release = () => undefined as void;
    const busy = limiter.run("news.example.com", signal, () => new Promise<void>((resolve) => (release = resolve)));
    const onStart = vi.fn();
    const fetch = vi.fn<FetchLike>(async () => page("<p>hi</p>"));

    const fetching = fetchText("https://news.example.com/a", options(fetch, { limiter, onStart }));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(onStart).not.toHaveBeenCalled();

    release();
    await busy;
    await fetching;
    expect(onStart).toHaveBeenCalledTimes(1);
    expect(onStart.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
  });
});

describe("createNodeFetch", () => {
  let server: Server;
  let port: number;
  let requests: number;

  beforeAll(async () => {
    requests = 0;
    server = createServer((_request, response) => {
      requests += 1;
      response.end("<p>A local page the reader must never reach.</p>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("refuses, on the real undici path, a public-looking name whose DNS answer is 127.0.0.1, and sends nothing", async () => {
    const resolveAll = vi.fn<ResolveAll>((_hostname, callback) => callback(null, [{ address: "127.0.0.1", family: 4 }]));
    const fetch = createNodeFetch({ resolveAll });

    const error = await fetchText(`http://news.example.com:${port}/a`, options(fetch)).catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(RefusedUrlError);
    expect(error).toMatchObject({ message: "Refused news.example.com: news.example.com resolves to a private address." });
    expect(resolveAll).toHaveBeenCalledWith("news.example.com", expect.any(Function));
    // Refused at connect time, before a socket was opened: the local server saw nothing.
    expect(requests).toBe(0);
  });

  it("refuses a name when any of its addresses is private, even if the first is public", async () => {
    const resolveAll: ResolveAll = (_hostname, callback) =>
      callback(null, [
        { address: "93.184.216.34", family: 4 },
        { address: "::1", family: 6 },
      ]);

    await expect(fetchText(`http://news.example.com:${port}/a`, options(createNodeFetch({ resolveAll })))).rejects.toBeInstanceOf(RefusedUrlError);
    expect(requests).toBe(0);
  });
});

describe("HostLimiter", () => {
  it("runs at most 2 tasks per host at once and starts the next when one ends", async () => {
    const limiter = new HostLimiter(2);
    const signal = new AbortController().signal;
    let running = 0;
    let peak = 0;
    const task = () =>
      limiter.run("a.example.com", signal, async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5));
        running -= 1;
      });
    const other = limiter.run("b.example.com", signal, async () => "other host is not held up");

    await Promise.all([task(), task(), task(), task(), other]);

    expect(peak).toBe(2);
    await expect(other).resolves.toBe("other host is not held up");
  });

  it("stops waiting for a slot when the signal aborts", async () => {
    const limiter = new HostLimiter(1);
    const controller = new AbortController();
    const blocker = limiter.run("a.example.com", controller.signal, () => new Promise(() => undefined));
    const waiting = limiter.run("a.example.com", controller.signal, async () => "never");

    controller.abort(new Error("deadline"));

    await expect(waiting).rejects.toThrow("deadline");
    void blocker;
  });
});
