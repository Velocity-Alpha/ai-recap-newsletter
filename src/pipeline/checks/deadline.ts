/**
 * Netlify stops a scheduled function at 30 s. Each outside call (Telegram, the site, the heartbeat) gets 5 s,
 * and the Telegram and site calls all stop 20 s into the run. That leaves time for the heartbeat and the
 * database. A send cut off by the deadline fails like any failed send, so the next check time retries it.
 */
export const CALL_TIMEOUT_MS = 5_000;
export const OUTSIDE_CALLS_BUDGET_MS = 20_000;

/** `base` with a per-call timeout and a shared deadline, on top of any signal the caller passes. */
export function withDeadline(base: typeof fetch, deadline: AbortSignal, timeoutMs = CALL_TIMEOUT_MS): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const signals = [deadline, AbortSignal.timeout(timeoutMs), ...(init?.signal ? [init.signal] : [])];
    return base(input, { ...init, signal: AbortSignal.any(signals) });
  }) as typeof fetch;
}
