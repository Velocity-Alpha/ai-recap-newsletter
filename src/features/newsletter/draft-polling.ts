import type { DraftStatus } from "@/src/pipeline/draft/draft-store";

/** How the drafts page polls one draft (#79). Safe for client components. */

export const POLL_MS = 3_000;
export const BACKOFF_POLL_MS = 10_000;

/** What the last read of the draft got. */
export type DraftPollOutcome =
  | { kind: "draft"; status: DraftStatus }
  | { kind: "error"; httpStatus: number }
  | { kind: "network" };

/** Signed out, or no such draft: reading again will not help. */
const FINAL_ERROR_STATUSES = new Set([401, 404]);

/**
 * Milliseconds until the next read, or null to stop. A running draft is read every few seconds. After an error the
 * page keeps trying, more slowly, and backs off to 10 s once errors repeat; it stops only when signed out or the
 * draft is gone. `consecutiveErrors` counts this error too.
 */
export function nextDraftPoll(outcome: DraftPollOutcome, consecutiveErrors: number): number | null {
  if (outcome.kind === "draft") return outcome.status === "running" ? POLL_MS : null;
  if (outcome.kind === "error" && FINAL_ERROR_STATUSES.has(outcome.httpStatus)) return null;
  return consecutiveErrors > 1 ? BACKOFF_POLL_MS : POLL_MS * 2;
}
