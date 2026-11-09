import { describe, expect, it, vi } from "vitest";

import { createGmailReader, readGmailCredentials } from "@/src/pipeline/publish/gmail-client";

const CREDENTIALS = { clientId: "client-id", clientSecret: "client-secret", refreshToken: "refresh-token" };

function b64url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

type Route = (url: URL, init?: RequestInit) => Response | undefined;

function fakeFetch(...routes: Route[]) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    for (const route of routes) {
      const response = route(url, init);
      if (response) return response;
    }
    throw new Error(`Unexpected request ${url.href}`);
  });
}

const tokenRoute: Route = (url) =>
  url.hostname === "oauth2.googleapis.com" ? json({ access_token: "access-1", expires_in: 3600 }) : undefined;

describe("readGmailCredentials", () => {
  it("reads the three Gmail OAuth values", () => {
    expect(
      readGmailCredentials({
        GMAIL_OAUTH_CLIENT_ID: "a",
        GMAIL_OAUTH_CLIENT_SECRET: "b",
        GMAIL_OAUTH_REFRESH_TOKEN: "c",
      }),
    ).toEqual({ clientId: "a", clientSecret: "b", refreshToken: "c" });
  });

  it("names every missing value", () => {
    expect(() => readGmailCredentials({ GMAIL_OAUTH_CLIENT_ID: "a" })).toThrow(
      "Missing Gmail settings: GMAIL_OAUTH_CLIENT_SECRET, GMAIL_OAUTH_REFRESH_TOKEN.",
    );
  });
});

describe("createGmailReader", () => {
  it("lists message ids across pages, up to the limit, with one token exchange", async () => {
    const fetch = fakeFetch(tokenRoute, (url, init) => {
      if (!url.pathname.endsWith("/users/me/messages")) return undefined;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer access-1");
      expect(url.searchParams.get("q")).toBe("from:newsletter@airecap.news newer_than:3d");
      return url.searchParams.get("pageToken") === "p2"
        ? json({ messages: [{ id: "m3" }, { id: "m4" }] })
        : json({ messages: [{ id: "m1" }, { id: "m2" }], nextPageToken: "p2" });
    });
    const gmail = createGmailReader(CREDENTIALS, { fetch });

    await expect(gmail.listMessageIds("from:newsletter@airecap.news newer_than:3d", 3)).resolves.toEqual([
      "m1",
      "m2",
      "m3",
    ]);
    await expect(gmail.listMessageIds("from:newsletter@airecap.news newer_than:3d", 1)).resolves.toEqual(["m1"]);

    const tokenCalls = fetch.mock.calls.filter(([input]) => String(input).includes("oauth2.googleapis.com"));
    expect(tokenCalls).toHaveLength(1);
  });

  it("returns no ids when the mailbox has no match", async () => {
    const gmail = createGmailReader(CREDENTIALS, {
      fetch: fakeFetch(tokenRoute, (url) => (url.pathname.endsWith("/messages") ? json({ resultSizeEstimate: 0 }) : undefined)),
    });

    await expect(gmail.listMessageIds("from:x", 10)).resolves.toEqual([]);
  });

  it("reads the subject, the Date header, the received time, and both body parts of a multipart message", async () => {
    const gmail = createGmailReader(CREDENTIALS, {
      fetch: fakeFetch(tokenRoute, (url) =>
        url.pathname.endsWith("/messages/m1")
          ? json({
              id: "m1",
              internalDate: "1793728100000",
              payload: {
                mimeType: "multipart/alternative",
                headers: [
                  { name: "Subject", value: "Today’s issue ✨" },
                  { name: "Date", value: "Tue, 03 Nov 2026 17:48:22 +0000" },
                ],
                parts: [
                  { mimeType: "text/plain", body: { data: b64url("plain") } },
                  { mimeType: "text/html", body: { data: b64url('<div data-issue-id="268">Café</div>') } },
                ],
              },
            })
          : undefined,
      ),
    });

    await expect(gmail.getMessage("m1")).resolves.toEqual({
      id: "m1",
      subject: "Today’s issue ✨",
      sentAt: new Date("2026-11-03T17:48:22.000Z"),
      receivedAt: new Date(1793728100000),
      html: '<div data-issue-id="268">Café</div>',
      text: "plain",
    });
  });

  it("falls back to the received time and fetches an HTML body stored as an attachment", async () => {
    const gmail = createGmailReader(CREDENTIALS, {
      fetch: fakeFetch(
        tokenRoute,
        (url) =>
          url.pathname.endsWith("/messages/m2/attachments/att-1") ? json({ data: b64url("<p>big</p>") }) : undefined,
        (url) =>
          url.pathname.endsWith("/messages/m2")
            ? json({
                id: "m2",
                internalDate: "1793728102000",
                payload: {
                  mimeType: "multipart/mixed",
                  headers: [{ name: "Date", value: "not a date" }],
                  parts: [
                    {
                      mimeType: "multipart/alternative",
                      parts: [{ mimeType: "text/html", body: { attachmentId: "att-1", size: 90000 } }],
                    },
                  ],
                },
              })
            : undefined,
      ),
    });

    await expect(gmail.getMessage("m2")).resolves.toEqual({
      id: "m2",
      subject: "",
      sentAt: new Date(1793728102000),
      receivedAt: new Date(1793728102000),
      html: "<p>big</p>",
      text: "",
    });
  });

  it("reports a failed token exchange without the secret values", async () => {
    const gmail = createGmailReader(CREDENTIALS, {
      fetch: fakeFetch((url) =>
        url.hostname === "oauth2.googleapis.com" ? json({ error: "invalid_grant" }, 400) : undefined,
      ),
    });

    const error = await gmail.listMessageIds("from:x", 5).catch((caught: Error) => caught);

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("Gmail token exchange failed with HTTP 400 (invalid_grant).");
    expect((error as Error).message).not.toContain("refresh-token");
  });

  it("reports a failed Gmail API call with its HTTP status", async () => {
    const gmail = createGmailReader(CREDENTIALS, {
      fetch: fakeFetch(tokenRoute, (url) => (url.pathname.endsWith("/messages/m9") ? json({}, 404) : undefined)),
    });

    await expect(gmail.getMessage("m9")).rejects.toThrow("Gmail request messages/m9 failed with HTTP 404.");
  });
});
