import { describe, expect, it } from "vitest";

import {
  buildPublishQuery,
  detectPublish,
  type PublishEventInput,
  type PublishStore,
  type StoredIssue,
} from "@/src/pipeline/publish/detect-publish";
import type { GmailMessage, GmailReader } from "@/src/pipeline/publish/gmail-client";
import { PLACEHOLDER_ISSUE, renderIssueEmail } from "@/src/pipeline/publish/sent-email.fixture";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";

const SENT_AT = new Date("2026-11-03T17:48:22.000Z");
const ISSUE_HTML = renderIssueEmail(PLACEHOLDER_ISSUE, { received: true });

function fakeGmail(messages: GmailMessage[]): GmailReader & { reads: string[] } {
  const reads: string[] = [];
  return {
    reads,
    // Gmail lists newest first.
    listMessageIds: async (_query, limit) => [...messages].reverse().map((m) => m.id).slice(0, limit),
    getMessage: async (id) => {
      reads.push(id);
      const message = messages.find((m) => m.id === id);
      if (!message) throw new Error(`no message ${id}`);
      return message;
    },
  };
}

function fakeStore(issues: StoredIssue[], known: string[] = []) {
  const events: PublishEventInput[] = [];
  const published: number[] = [];
  const store: PublishStore = {
    knownMessageIds: async (_mode, ids) => new Set(ids.filter((id) => known.includes(id))),
    findIssue: async (id) => issues.find((issue) => issue.id === id) ?? null,
    recordEvent: async (event) => {
      events.push(event);
    },
    publish: async ({ issueId, publishedAt, event }) => {
      const issue = issues.find((i) => i.id === issueId)!;
      const outcome = issue.publishedAt ? "already_published" : "published";
      if (outcome === "published") {
        issue.publishedAt = publishedAt;
        published.push(issueId);
      }
      events.push({ ...event, outcome });
      return outcome;
    },
  };
  return { store, events, published };
}

const message = (id: string, html = ISSUE_HTML, sentAt = SENT_AT): GmailMessage => ({
  id,
  subject: "♊️ Placeholder Title For Tests",
  sentAt,
  receivedAt: sentAt,
  html,
  text: "",
});

// Gmail lists newest first.
const newestFirst = (gmail: GmailReader) => gmail.listMessageIds("q", 10);

describe("buildPublishQuery", () => {
  const since = new Date("2026-11-09T15:40:00.000Z");

  it("filters on the sending address and mail received after a time, in epoch seconds", () => {
    expect(buildPublishQuery({ since })).toBe("from:newsletter@airecap.news after:1794238800");
  });

  it("adds the seed recipients when they are configured", () => {
    expect(buildPublishQuery({ recipients: ["a@example.test", " b@example.test "], since })).toBe(
      "from:newsletter@airecap.news (to:a@example.test OR to:b@example.test) after:1794238800",
    );
  });
});

describe("detectPublish", () => {
  it("in shadow mode records what it would publish and compares it with the stored content, without publishing", async () => {
    const stored = parseSentEmail(ISSUE_HTML)!.content;
    const { store, events, published } = fakeStore([
      { id: 268, publishedAt: SENT_AT, contentJson: { ...stored, title: "Different Title" } },
    ]);

    const gmail = fakeGmail([message("m1")]);
    const summary = await detectPublish({ gmail, store }, { mode: "shadow", messageIds: await newestFirst(gmail) });

    expect(published).toEqual([]);
    expect(events).toEqual([
      {
        mode: "shadow",
        outcome: "would_publish",
        gmailMessageId: "m1",
        receivedAt: SENT_AT,
        issueId: 268,
        subject: "♊️ Placeholder Title For Tests",
        title: "Placeholder Title For Tests",
        storyIds: [11023, 11007, 10996, 11009, 11010, 10998],
        contentJson: stored,
        problems: [],
        draftId: null,
      },
    ]);
    expect(summary.results).toEqual([
      {
        gmailMessageId: "m1",
        issueId: 268,
        outcome: "would_publish",
        differences: ['title: native="Placeholder Title For Tests" published="Different Title"'],
      },
    ]);
  });

  it("in native mode publishes from the oldest copy and marks the second copy already published", async () => {
    const { store, events, published } = fakeStore([{ id: 268, publishedAt: null, contentJson: null }]);
    const later = new Date(SENT_AT.getTime() + 1000);

    const gmail = fakeGmail([message("first"), message("second", ISSUE_HTML, later)]);
    const summary = await detectPublish({ gmail, store }, { mode: "native", messageIds: await newestFirst(gmail) });

    expect(published).toEqual([268]);
    expect(events.map((e) => [e.gmailMessageId, e.outcome])).toEqual([
      ["first", "published"],
      ["second", "already_published"],
    ]);
    expect(summary.results.map((r) => r.outcome)).toEqual(["published", "already_published"]);
  });

  it("skips messages it has already handled in this mode, and records other mail as not an issue", async () => {
    const gmail = fakeGmail([message("seen"), message("promo", "<p>Upgrade your plan</p>")]);
    const { store, events } = fakeStore([], ["seen"]);

    const summary = await detectPublish({ gmail, store }, { mode: "shadow", messageIds: await newestFirst(gmail) });

    expect(gmail.reads).toEqual(["promo"]);
    expect(summary.skipped).toBe(1);
    expect(events).toMatchObject([{ gmailMessageId: "promo", outcome: "not_an_issue", issueId: null, storyIds: [] }]);
  });

  it("records which native draft was sent when the email carries a draft id", async () => {
    const html = ISSUE_HTML.replace('data-issue-id="268"', 'data-issue-id="268" data-draft-id="41"');
    const { store, events } = fakeStore([{ id: 268, publishedAt: null, contentJson: null }]);

    const gmail = fakeGmail([message("m1", html)]);
    await detectPublish({ gmail, store }, { mode: "native", messageIds: await newestFirst(gmail) });

    expect(events).toMatchObject([{ gmailMessageId: "m1", outcome: "published", draftId: 41 }]);
  });

  it("keeps going after one message fails, and reports the failure", async () => {
    const gmail = fakeGmail([message("ok")]);
    const { store } = fakeStore([{ id: 268, publishedAt: null, contentJson: null }]);

    const summary = await detectPublish({ gmail, store }, { mode: "native", messageIds: ["broken", "ok"] });

    expect(summary.results.map((r) => r.gmailMessageId)).toEqual(["ok"]);
    expect(summary.errors).toEqual([{ gmailMessageId: "broken", message: "no message broken" }]);
  });
});
