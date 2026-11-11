import { describe, expect, it, vi } from "vitest";

import { CALL_TIMEOUT_MS, OUTSIDE_CALLS_BUDGET_MS, SITE_CALL_TIMEOUT_MS, withDeadline } from "@/src/pipeline/checks/deadline";

function signalOf(base: ReturnType<typeof vi.fn>): AbortSignal {
  return (base.mock.calls[0][1] as RequestInit).signal as AbortSignal;
}

describe("withDeadline", () => {
  it("keeps the whole run under Netlify's 30 s limit", () => {
    expect(CALL_TIMEOUT_MS).toBe(5_000);
    // The heartbeat gets its own call after the budget, and the database needs a few seconds.
    expect(OUTSIDE_CALLS_BUDGET_MS + CALL_TIMEOUT_MS).toBeLessThanOrEqual(25_000);
  });

  it("gives the site more time than a cold server function needs, inside the budget", () => {
    // Cold requests took up to 8.6 s on 2026-11-10.
    expect(SITE_CALL_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    // The alerts that follow the site check still need one call.
    expect(SITE_CALL_TIMEOUT_MS + CALL_TIMEOUT_MS).toBeLessThanOrEqual(OUTSIDE_CALLS_BUDGET_MS);
  });

  it("passes the request through, with a signal", async () => {
    const base = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
    const limited = withDeadline(base as unknown as typeof fetch, new AbortController().signal);

    await expect(limited("https://example.org/", { method: "POST", body: "x" })).resolves.toBeInstanceOf(Response);
    expect(base).toHaveBeenCalledWith("https://example.org/", expect.objectContaining({ method: "POST", body: "x" }));
    expect(signalOf(base).aborted).toBe(false);
  });

  it("aborts every call once the run's deadline passes", async () => {
    const deadline = new AbortController();
    const base = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
    const limited = withDeadline(base as unknown as typeof fetch, deadline.signal);

    await limited("https://example.org/");
    deadline.abort(new Error("deadline"));

    expect(signalOf(base).aborted).toBe(true);
  });

  it("aborts one slow call after its own timeout, and keeps the caller's signal", async () => {
    const base = vi.fn<(input: unknown, init?: RequestInit) => Promise<Response>>(async () => new Response("ok"));
    const caller = new AbortController();
    const limited = withDeadline(base as unknown as typeof fetch, new AbortController().signal, 20);

    await limited("https://example.org/", { signal: caller.signal });
    const signal = signalOf(base);
    await new Promise((resolve) => setTimeout(resolve, 40));
    expect(signal.aborted).toBe(true);

    await limited("https://example.org/", { signal: caller.signal });
    caller.abort();
    expect((base.mock.calls[1][1] as RequestInit).signal?.aborted).toBe(true);
  });
});
