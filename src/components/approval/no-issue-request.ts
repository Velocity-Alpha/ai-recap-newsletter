const ENDPOINT = "/api/approval/skipped-dates";
const JSON_HEADERS = { "content-type": "application/json" };

/**
 * The request that marks (skip = true) or undoes a "No issue today" date.
 * Both send a JSON Content-Type: the Origin check on /api/approval/* answers writes without one with 415.
 */
export function noIssueRequest(date: string, skip: boolean): [string, RequestInit] {
  if (skip) return [ENDPOINT, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ date }) }];
  return [`${ENDPOINT}?${new URLSearchParams({ date })}`, { method: "DELETE", headers: JSON_HEADERS, body: "{}" }];
}
