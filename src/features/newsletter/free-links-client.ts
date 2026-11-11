/** The board's side of the paywall rules for a story's link (#59). */

import type { PaywallStatus } from "@/src/pipeline/ingest/paywall";

const STATES: readonly unknown[] = ["yes", "no", "unknown", "error"] satisfies PaywallStatus[];

interface CheckLinkOptions {
  fetcher?: (url: string, init: RequestInit) => Promise<Response>;
}

/** Asks /api/approval/check-link if a link the reviewer typed is paywalled. Never throws: a failure is "error". */
export async function checkLink(url: string, options: CheckLinkOptions = {}): Promise<PaywallStatus> {
  const { fetcher = (input, init) => fetch(input, init) } = options;
  try {
    const response = await fetcher("/api/approval/check-link", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    if (!response.ok) return "error";
    const reply = (await response.json()) as { paywall?: unknown };
    return STATES.includes(reply.paywall) ? (reply.paywall as PaywallStatus) : "error";
  } catch {
    return "error";
  }
}
