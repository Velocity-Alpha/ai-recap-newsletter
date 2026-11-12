/** Pure helpers of the live search backtest (#86). */

export interface Window {
  start: Date;
  end: Date;
}

/** The issue on date D covers news from 24 h before the previous weekday's 09:00 UTC run up to 09:00 UTC on D. */
export function windowFor(issueDate: string): Window {
  const end = new Date(`${issueDate}T09:00:00Z`);
  const prev = new Date(end);
  do prev.setUTCDate(prev.getUTCDate() - 1);
  while ([0, 6].includes(prev.getUTCDay()));
  return { start: new Date(prev.getTime() - 24 * 3600 * 1000), end };
}

/** Host and path, lower case, with no www, query, trailing slash or locale segment (openai.com/ca-ES/...). */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    const pathname = u.pathname.replace(/^\/[a-z]{2}-[A-Za-z]{2,4}(?=\/)/, "").replace(/\/$/, "");
    return `${u.hostname.replace(/^www\./, "")}${pathname}`.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

export function isExcluded(url: string, domains: readonly string[]): boolean {
  const host = normalizeUrl(url).split("/")[0];
  return domains.some((d) => host === d || host.endsWith(`.${d}`));
}
