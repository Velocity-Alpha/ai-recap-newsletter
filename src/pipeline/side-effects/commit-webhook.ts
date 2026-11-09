import { isProduction } from "@/src/pipeline/side-effects";

/** n8n's production approval webhook. It creates real issues and GHL templates. */
export const PRODUCTION_COMMIT_WEBHOOK_URL = "https://n8n.velocityalpha.com/webhook/story/approval";

export type CommitWebhookTarget = { ok: true; url: string } | { ok: false; error: string };

function sameUrl(a: string, b: string): boolean {
  try {
    const left = new URL(a);
    const right = new URL(b);
    const path = (url: URL) => url.pathname.replace(/\/+$/, "");
    return left.host.toLowerCase() === right.host.toLowerCase() && path(left) === path(right);
  } catch {
    return false;
  }
}

/**
 * Where the commit route may post an outline. Production keeps its old default. Elsewhere a commit needs an
 * explicit non-production webhook, so a preview can never create a production issue.
 */
export function resolveCommitWebhook(env: Record<string, string | undefined>): CommitWebhookTarget {
  const configured = env.OUTLINE_COMMIT_WEBHOOK_URL?.trim();
  if (isProduction(env.APP_ENV)) return { ok: true, url: configured || PRODUCTION_COMMIT_WEBHOOK_URL };
  if (!configured) {
    return {
      ok: false,
      error: "Commit is off outside production. Set OUTLINE_COMMIT_WEBHOOK_URL to a non-production webhook.",
    };
  }
  if (sameUrl(configured, PRODUCTION_COMMIT_WEBHOOK_URL)) {
    return {
      ok: false,
      error: "OUTLINE_COMMIT_WEBHOOK_URL points at the production n8n webhook. Use a non-production webhook here.",
    };
  }
  return { ok: true, url: configured };
}

/** `YYYY-MM-DD`, optionally followed by a time. Returns the calendar date as written, or null. */
export function parseCommitDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value.trim());
  if (!match) return null;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return null;
  return `${year}-${month}-${day}`;
}
