import { lookup as dnsLookup } from "node:dns";

import { Agent, fetch as undiciFetch } from "undici";

import { assertPublicUrl, createGuardedLookup, RefusedUrlError, type ResolveAll } from "@/src/pipeline/draft/articles/address-guard";

/** The part of `fetch` the reader uses, so tests can pass a fake. Redirects are followed by `fetchText`. */
export interface FetchInit {
  method: "GET";
  headers: Record<string, string>;
  redirect: "manual";
  signal: AbortSignal;
}

export interface FetchResponse {
  status: number;
  headers: { get(name: string): string | null };
  body: {
    getReader(): { read(): Promise<{ done: boolean; value?: Uint8Array }>; cancel(reason?: unknown): Promise<void> };
  } | null;
}

export type FetchLike = (url: string, init: FetchInit) => Promise<FetchResponse>;

export type FetchFailureKind = "network" | "too_large" | "redirects" | "wrong_type";

export class FetchFailure extends Error {
  constructor(
    readonly kind: FetchFailureKind,
    message: string,
  ) {
    super(message);
    this.name = "FetchFailure";
  }
}

export interface FetchedText {
  status: number;
  /** After redirects. */
  url: string;
  contentType: string;
  body: string;
}

export interface FetchTextOptions {
  fetch: FetchLike;
  /** Aborts the request; its reason is rethrown. */
  signal: AbortSignal;
  headers?: Record<string, string>;
  maxBytes: number;
  limiter?: HostLimiter;
  /** Called as each request gets its host slot (at once without a limiter). */
  onStart?: () => void;
  /** Checks a successful answer's media type before its body is read: a reason refuses it, null reads it. */
  rejectType?: (mediaType: string) => string | null;
}

const MAX_REDIRECTS = 5;

/** `text/html` from `text/html; charset=utf-8`. */
export function mediaType(contentType: string): string {
  return contentType.split(";")[0].trim().toLowerCase();
}
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** Caps how many requests go to one host at once (#115: at most 2), across all the stories being read. */
export class HostLimiter {
  private readonly active = new Map<string, number>();
  private readonly waiting = new Map<string, Array<() => void>>();

  constructor(private readonly perHost: number) {}

  async run<T>(host: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    await this.acquire(host, signal);
    try {
      return await task();
    } finally {
      this.release(host);
    }
  }

  private acquire(host: string, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(signal.reason);
    if ((this.active.get(host) ?? 0) < this.perHost) {
      this.active.set(host, (this.active.get(host) ?? 0) + 1);
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const queue = this.waiting.get(host) ?? [];
      const grant = () => {
        signal.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        queue.splice(queue.indexOf(grant), 1);
        reject(signal.reason);
      };
      queue.push(grant);
      this.waiting.set(host, queue);
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private release(host: string): void {
    const next = this.waiting.get(host)?.shift();
    // The slot passes straight to the next waiter, so the count stays the same.
    if (next) return next();
    this.active.set(host, (this.active.get(host) ?? 1) - 1);
  }
}

function formatBytes(bytes: number): string {
  return bytes >= 1_000_000 ? `${Math.round(bytes / 100_000) / 10} MB` : `${Math.round(bytes / 100) / 10} KB`;
}

function decoderFor(contentType: string): TextDecoder {
  const charset = contentType.match(/charset="?([^";\s]+)/i)?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8");
  } catch {
    return new TextDecoder("utf-8");
  }
}

async function readBody(response: FetchResponse, maxBytes: number): Promise<string> {
  const contentType = response.headers.get("content-type") ?? "";
  const declared = Number(response.headers.get("content-length"));
  const tooLarge = () => new FetchFailure("too_large", `The response is over the ${formatBytes(maxBytes)} cap.`);
  if (Number.isFinite(declared) && declared > maxBytes) {
    await response.body?.getReader().cancel().catch(() => undefined);
    throw tooLarge();
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return decoderFor(contentType).decode(bytes);
}

function networkFailure(error: unknown): FetchFailure {
  const cause = (error as { cause?: { code?: unknown; message?: unknown } } | null)?.cause;
  const detail = typeof cause?.code === "string" ? cause.code : typeof cause?.message === "string" ? cause.message : null;
  const message = error instanceof Error ? error.message : String(error);
  return new FetchFailure("network", `Network error: ${message}${detail ? ` (${detail})` : ""}.`);
}

/** Errors that a retry cannot fix: our own failures, and the address guard (undici puts it in `cause`). */
function finalError(error: unknown): unknown {
  if (error instanceof FetchFailure || error instanceof RefusedUrlError) return error;
  const cause = (error as { cause?: unknown } | null)?.cause;
  return cause instanceof RefusedUrlError ? cause : null;
}

async function requestOnce(url: URL, headers: Record<string, string>, options: FetchTextOptions): Promise<{ response: FetchResponse; body: string | null }> {
  const send = async () => {
    options.onStart?.();
    const response = await options.fetch(url.href, { method: "GET", headers, redirect: "manual", signal: options.signal });
    if (REDIRECT_STATUSES.has(response.status) && response.headers.get("location")) {
      await response.body?.getReader().cancel().catch(() => undefined);
      return { response, body: null };
    }
    const refused = response.status < 400 ? options.rejectType?.(mediaType(response.headers.get("content-type") ?? "")) : null;
    if (refused) {
      await response.body?.getReader().cancel().catch(() => undefined);
      throw new FetchFailure("wrong_type", refused);
    }
    return { response, body: await readBody(response, options.maxBytes) };
  };
  const run = () => (options.limiter ? options.limiter.run(url.host, options.signal, send) : send());

  try {
    return await run();
  } catch (error) {
    if (options.signal.aborted) throw options.signal.reason;
    const final = finalError(error);
    if (final) throw final;
    // #115: one retry fixed every network error seen in the sample.
    try {
      return await run();
    } catch (retryError) {
      if (options.signal.aborted) throw options.signal.reason;
      throw finalError(retryError) ?? networkFailure(retryError);
    }
  }
}

/**
 * GETs a URL and returns its body as text. Every hop is checked with `assertPublicUrl`, at most 5 redirects are
 * followed, the body stops at `maxBytes`, and an Authorization header is dropped when a redirect leaves the origin.
 */
export async function fetchText(link: string, options: FetchTextOptions): Promise<FetchedText> {
  let url = assertPublicUrl(link);
  let headers = { ...(options.headers ?? {}) };
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    if (options.signal.aborted) throw options.signal.reason;
    const { response, body } = await requestOnce(url, headers, options);
    if (body === null) {
      const next = assertPublicUrl(new URL(response.headers.get("location") ?? "", url).href);
      if (next.origin !== url.origin) {
        headers = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"));
      }
      url = next;
      continue;
    }
    return { status: response.status, url: url.href, contentType: response.headers.get("content-type") ?? "", body };
  }
  throw new FetchFailure("redirects", `Too many redirects (over ${MAX_REDIRECTS}).`);
}

let sharedAgent: Agent | null = null;

const systemResolver: ResolveAll = (hostname, callback) =>
  dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => callback(error, addresses ?? []));

function guardedAgent(resolveAll: ResolveAll): Agent {
  return new Agent({ maxHeaderSize: 64 * 1024, connect: { lookup: createGuardedLookup(resolveAll) as never } });
}

/**
 * The real network: undici with the address guard at connect time, and a larger header limit (finance.yahoo.com
 * sends response headers over Node's 16 KB default, #115). `resolveAll` replaces DNS (tests).
 */
export function createNodeFetch(options: { resolveAll?: ResolveAll } = {}): FetchLike {
  const dispatcher = options.resolveAll ? guardedAgent(options.resolveAll) : (sharedAgent ??= guardedAgent(systemResolver));
  return (url, init) => undiciFetch(url, { ...init, dispatcher }) as unknown as Promise<FetchResponse>;
}
