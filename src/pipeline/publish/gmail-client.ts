/**
 * Read-only Gmail REST client for publish detection (scope `gmail.readonly`). It exchanges the stored
 * refresh token for an access token, lists message ids for a search query, and reads one message's
 * subject, send time, and HTML body. Error messages never include credential values.
 */

export interface GmailCredentials {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
}

export interface GmailMessage {
  id: string;
  subject: string;
  /** The `Date` header (what n8n used for `published_at`), or Gmail's received time if it is unreadable. */
  sentAt: Date;
  html: string;
}

export interface GmailReader {
  listMessageIds(query: string, limit: number): Promise<string[]>;
  getMessage(id: string): Promise<GmailMessage>;
}

interface GmailPart {
  mimeType?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API_BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
// Refresh a minute early so a token never expires mid-request.
const TOKEN_SAFETY_MS = 60_000;

const CREDENTIAL_ENV = {
  clientId: "GMAIL_OAUTH_CLIENT_ID",
  clientSecret: "GMAIL_OAUTH_CLIENT_SECRET",
  refreshToken: "GMAIL_OAUTH_REFRESH_TOKEN",
} as const;

export function readGmailCredentials(env: Record<string, string | undefined>): GmailCredentials {
  const missing = Object.values(CREDENTIAL_ENV).filter((name) => !env[name]?.trim());
  if (missing.length > 0) throw new Error(`Missing Gmail settings: ${missing.join(", ")}.`);
  return {
    clientId: env[CREDENTIAL_ENV.clientId]!.trim(),
    clientSecret: env[CREDENTIAL_ENV.clientSecret]!.trim(),
    refreshToken: env[CREDENTIAL_ENV.refreshToken]!.trim(),
  };
}

function findHtmlPart(part: GmailPart | undefined): GmailPart | null {
  if (!part) return null;
  if (part.mimeType === "text/html") return part;
  for (const child of part.parts ?? []) {
    const found = findHtmlPart(child);
    if (found) return found;
  }
  return null;
}

function header(part: GmailPart | undefined, name: string): string {
  return part?.headers?.find((entry) => entry.name.toLowerCase() === name)?.value ?? "";
}

function decode(data: string): string {
  return Buffer.from(data, "base64url").toString("utf8");
}

export function createGmailReader(
  credentials: GmailCredentials,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): GmailReader {
  const fetchImpl = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let token: { value: string; expiresAt: number } | null = null;

  async function accessToken(): Promise<string> {
    if (token && token.expiresAt > now()) return token.value;
    const response = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: credentials.clientId,
        client_secret: credentials.clientSecret,
        refresh_token: credentials.refreshToken,
        grant_type: "refresh_token",
      }),
    });
    const body = (await response.json().catch(() => ({}))) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
    };
    if (!response.ok || !body.access_token) {
      const reason = typeof body.error === "string" ? ` (${body.error})` : "";
      throw new Error(`Gmail token exchange failed with HTTP ${response.status}${reason}.`);
    }
    token = { value: body.access_token, expiresAt: now() + (body.expires_in ?? 3600) * 1000 - TOKEN_SAFETY_MS };
    return token.value;
  }

  async function get<T>(path: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${API_BASE}/${path}`);
    for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
    const response = await fetchImpl(url, { headers: { authorization: `Bearer ${await accessToken()}` } });
    if (!response.ok) throw new Error(`Gmail request ${path} failed with HTTP ${response.status}.`);
    return (await response.json()) as T;
  }

  return {
    async listMessageIds(query, limit) {
      const ids: string[] = [];
      let pageToken: string | undefined;
      do {
        const page = await get<{ messages?: Array<{ id: string }>; nextPageToken?: string }>("messages", {
          q: query,
          maxResults: String(Math.min(100, limit)),
          ...(pageToken ? { pageToken } : {}),
        });
        ids.push(...(page.messages ?? []).map((message) => message.id));
        pageToken = page.nextPageToken;
      } while (pageToken && ids.length < limit);
      return ids.slice(0, limit);
    },

    async getMessage(id) {
      const message = await get<{ id: string; internalDate?: string; payload?: GmailPart }>(`messages/${id}`, {
        format: "full",
      });
      const htmlPart = findHtmlPart(message.payload);
      let html = "";
      if (htmlPart?.body?.data) {
        html = decode(htmlPart.body.data);
      } else if (htmlPart?.body?.attachmentId) {
        const attachment = await get<{ data?: string }>(`messages/${id}/attachments/${htmlPart.body.attachmentId}`);
        html = attachment.data ? decode(attachment.data) : "";
      }

      const dateHeader = new Date(header(message.payload, "date"));
      const sentAt = Number.isNaN(dateHeader.getTime()) ? new Date(Number(message.internalDate ?? 0)) : dateHeader;

      return { id: message.id, subject: header(message.payload, "subject"), sentAt, html };
    },
  };
}
