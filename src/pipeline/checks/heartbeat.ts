import { CALL_TIMEOUT_MS } from "@/src/pipeline/checks/deadline";

/**
 * The heartbeat (GLOSSARY.md): after the 18:00 summary, ping Healthchecks.io. If a weekday ping does not
 * arrive, Healthchecks.io emails the owner. When the summary did not reach the ops chat, ping the check's
 * `/fail` URL instead, so the owner hears about it by email. Production only, and it never throws.
 */

export type HeartbeatResult =
  | { status: "sent" }
  | { status: "failed"; reason: string }
  | { status: "not_configured" }
  | { status: "not_production" };

export async function pingHeartbeat(options: {
  env: Record<string, string | undefined>;
  /** False pings the fail URL. */
  ok: boolean;
  /** A short status line Healthchecks.io keeps with the ping. No secrets. */
  body: string;
  fetch?: typeof fetch;
}): Promise<HeartbeatResult> {
  if (options.env.APP_ENV !== "production") return { status: "not_production" };
  const url = options.env.HEALTHCHECKS_PING_URL?.trim().replace(/\/+$/, "");
  if (!url) return { status: "not_configured" };

  const send = options.fetch ?? fetch;
  try {
    const response = await send(options.ok ? url : `${url}/fail`, {
      method: "POST",
      body: options.body,
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
    return response.ok ? { status: "sent" } : { status: "failed", reason: `HTTP ${response.status}` };
  } catch (error) {
    return { status: "failed", reason: error instanceof Error ? error.message : String(error) };
  }
}
