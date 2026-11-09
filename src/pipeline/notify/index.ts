/**
 * Ops alerts about incidents (GLOSSARY.md), sent to the "AI Recap Ops" Telegram chat. GitHub issue #48.
 *
 * Rules
 * - Production only. Outside `APP_ENV=production` nothing is sent: the text goes into the run's
 *   pipeline_events (pass `runId`), or a structured console log when there is no run.
 * - One incident per `incidentKey`, stored in the `alerts` table. Re-raising an open incident refreshes it.
 * - critical: sent at once, and again at each check time while open (call `resendOpenCriticals`).
 *   warning: sent once per incident. info: never sent; the daily summary reads it (`listInfoIncidents`).
 * - The channel is the review bot (`TELEGRAM_REVIEW_BOT_TOKEN`) posting to `TELEGRAM_OPS_CHAT_ID`. It never
 *   posts to the review group and has no fallback chat: a missing id gives `not_configured`.
 * - A failed send never throws (database errors do). Each call returns a delivery: sent | recorded |
 *   failed | not_configured, or skipped when the rules say no message this time.
 *
 * API (all options take { now?, runId?, env?, channel? })
 * - raiseIncident({ incidentKey, severity, what, evidence, link, details? }, options)
 *     -> { opened, alertId, delivery }. Call each time a check fails.
 * - resolveIncident(incidentKey, { ...options, link?, note? }) -> { resolved, delivery }.
 *     Call each time a check passes; it posts "resolved" only if an open incident was alerted.
 * - resendOpenCriticals({ ...options, minGapMs? }) -> [{ incidentKey, delivery }].
 *     Call once per check time, after that check's raise/resolve calls.
 * - postToOpsChat(text, options) -> delivery. Any other ops message, e.g. the daily summary (#52).
 * - listOpenIncidents(), listInfoIncidents(since) -> Alert rows for the daily summary.
 * - runLink(runId), adminLink(path?) -> https://airecap.news/admin/... links for `link`.
 * - AlertChannel { name; send(text) }: to swap Telegram for Slack (#119), change only `opsChannelFromEnv`.
 */
export {
  createTelegramOpsChannel,
  opsChannelFromEnv,
  type AlertChannel,
  type OpsChannelResult,
} from "@/src/pipeline/notify/channel";
export { adminLink, buildAlertText, buildResolvedText, runLink } from "@/src/pipeline/notify/message";
export {
  listInfoIncidents,
  listOpenIncidents,
  postToOpsChat,
  raiseIncident,
  resendOpenCriticals,
  resolveIncident,
  type Delivery,
  type IncidentInput,
  type NotifyOptions,
  type RaiseIncidentResult,
  type ResolveIncidentResult,
} from "@/src/pipeline/notify/notify";
export type { AlertSeverity } from "@/src/pipeline/alerts";
