import { describe, expect, it, vi } from "vitest";

import { fakeWeb, htmlPage, jinaError, jinaUrl, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { SAMPLE_APPROVED, SAMPLE_CONTENT, SAMPLE_OUTLINE } from "@/src/pipeline/draft/draft.fixture";
import type { IssueWriter } from "@/src/pipeline/draft/writer";
import {
  commitOutline,
  parseReplayArgs,
  readN8nIssue,
  renderReplayIndex,
  replayArticleReader,
  replayDraft,
  type ReplayReport,
} from "@/src/pipeline/draft/replay";

const N8N_ISSUE = {
  id: "268",
  title: "An n8n Title",
  issue_date: "2027-01-04T05:00:00.000Z",
  html: "<html><body>n8n email</body></html>",
  feature_image_url: " https://assets.example.test/newsletter/gemini-2027.jpeg ",
  prompt_featured_image: "A pretend lab at dawn.",
};

const COMMIT_BODY = {
  date: "2027-01-04",
  approved_ids_by_section: { headlines: [501, 502], research: [503, 504], tools: [505, 506], quickHits: [507, 508] },
  newsletter_headline: 501,
  candidate_sections: [{ key: "headlines" }, { key: "research" }, { key: "tools" }, { key: "quickHits" }],
  stories: [{ id: 501, newsletter_category: "headlines", url: "https://news.example.test/planner?ref=feed&id=1", note: "" }],
};

describe("parseReplayArgs", () => {
  it("pairs each commit with the n8n issue after it", () => {
    expect(
      parseReplayArgs(["--", "--out", "tmp/r", "--commit", "a.json", "--reuse-image-from", "a-issue.json", "--commit", "b.json", "--reuse-image-from", "b-issue.json"]),
    ).toEqual({
      out: "tmp/r",
      pairs: [
        { commit: "a.json", issue: "a-issue.json" },
        { commit: "b.json", issue: "b-issue.json" },
      ],
      read: true,
    });
  });

  it("skips reading articles with --no-read", () => {
    expect(parseReplayArgs(["--out", "o", "--no-read", "--commit", "a.json", "--reuse-image-from", "i.json"])).toMatchObject({ read: false });
  });

  it("explains what is missing", () => {
    expect(() => parseReplayArgs(["--commit", "a.json", "--reuse-image-from", "i.json"])).toThrow("--out");
    expect(() => parseReplayArgs(["--out", "o"])).toThrow("--commit");
    expect(() => parseReplayArgs(["--out", "o", "--commit", "a.json"])).toThrow("a.json has no --reuse-image-from");
    expect(() => parseReplayArgs(["--out", "o", "--reuse-image-from", "i.json"])).toThrow("--reuse-image-from must follow a --commit");
    expect(() => parseReplayArgs(["--out", "o", "--bogus"])).toThrow('Unknown argument "--bogus"');
  });
});

describe("commitOutline and readN8nIssue", () => {
  it("normalises the board's commit body, wrapped or not", () => {
    expect(commitOutline(COMMIT_BODY)).toMatchObject({ date: "2027-01-04", leadStoryId: 501, sections: SAMPLE_OUTLINE.sections });
    expect(commitOutline([{ ...COMMIT_BODY, date: undefined }], "2027-01-04").date).toBe("2027-01-04");
    expect(() => commitOutline({ ...COMMIT_BODY, date: undefined })).toThrow("no valid date");
  });

  it("reads an n8n issue row with snake_case or camelCase keys", () => {
    const expected = {
      id: 268,
      date: "2027-01-04",
      title: "An n8n Title",
      html: "<html><body>n8n email</body></html>",
      featuredImageUrl: "https://assets.example.test/newsletter/gemini-2027.jpeg",
      scenePrompt: "A pretend lab at dawn.",
    };
    expect(readN8nIssue([N8N_ISSUE])).toEqual(expected);
    expect(
      readN8nIssue({
        id: 268,
        title: "An n8n Title",
        issueDate: "2027-01-04",
        html: N8N_ISSUE.html,
        featureImageUrl: N8N_ISSUE.feature_image_url,
        promptFeaturedImage: N8N_ISSUE.prompt_featured_image,
      }),
    ).toEqual(expected);
    expect(() => readN8nIssue({ ...N8N_ISSUE, feature_image_url: " " })).toThrow("The n8n issue has no feature_image_url.");
  });
});

describe("replayDraft", () => {
  const issue = readN8nIssue(N8N_ISSUE);

  it("drafts with n8n's image, and reports content, problems, and timings", async () => {
    const writer: IssueWriter = vi.fn(async () => structuredClone(SAMPLE_CONTENT));

    const result = await replayDraft({ outline: SAMPLE_OUTLINE, stories: SAMPLE_APPROVED, n8nIssue: issue }, { writer });

    expect(result.nativeHtml).toContain(issue.featuredImageUrl);
    expect(result.nativeHtml).toContain('data-issue-id="268"');
    expect(result.n8nHtml).toBe(issue.html);
    expect(result.report).toMatchObject({
      date: "2027-01-04",
      status: "ready",
      title: { native: SAMPLE_CONTENT.title, n8n: "An n8n Title" },
      problems: [],
      unreadStoryIds: [501, 502, 503, 504],
      scenePrompt: "A pretend lab at dawn.",
    });
    expect(Object.keys(result.report.timings)).toEqual(["read_articles", "write", "validate", "image", "html"]);
  });

  it("makes no email in the distribution service: no draft row, no network, and no GHL template in the report", async () => {
    const writer: IssueWriter = vi.fn(async () => structuredClone(SAMPLE_CONTENT));
    const network = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", network);

    try {
      const result = await replayDraft({ outline: SAMPLE_OUTLINE, stories: SAMPLE_APPROVED, n8nIssue: issue }, { writer });

      expect(result.report.status).toBe("ready");
      expect(result.report).not.toHaveProperty("ghlTemplate");
      // The replay has no draft row, so its email carries draft id 0, which the parser reads as no draft.
      expect(result.nativeHtml).toContain('data-draft-id="0"');
    } finally {
      vi.unstubAllGlobals();
    }
    expect(network).not.toHaveBeenCalled();
  });

  it("reports no GHL template for a failed replay either", async () => {
    const writer: IssueWriter = vi.fn(async () => Promise.reject(new Error("The writer refused: no.")));

    const result = await replayDraft({ outline: SAMPLE_OUTLINE, stories: SAMPLE_APPROVED, n8nIssue: issue }, { writer });

    expect(result.report.status).toBe("failed");
    expect(result.report).not.toHaveProperty("ghlTemplate");
    expect(Object.keys(result.report.timings)).toEqual(["read_articles", "write"]);
  });

  it("still renders the email when the checks fail, and lists the problems", async () => {
    const writer: IssueWriter = vi.fn(async () => ({ ...structuredClone(SAMPLE_CONTENT), title: "Short" }));

    const result = await replayDraft({ outline: SAMPLE_OUTLINE, stories: SAMPLE_APPROVED, n8nIssue: issue }, { writer });

    expect(result.report).toMatchObject({ status: "failed", failedStep: "validate" });
    expect(result.report.problems[0]).toContain("The title has 1 word");
    expect(result.nativeHtml).toContain("Short");
  });

  it("shows the error in place of the email when writing fails", async () => {
    const writer: IssueWriter = vi.fn(async () => Promise.reject(new Error("The writer refused: <no>.")));

    const result = await replayDraft({ outline: SAMPLE_OUTLINE, stories: SAMPLE_APPROVED, n8nIssue: issue }, { writer });

    expect(result.report).toMatchObject({ status: "failed", failedStep: "write", error: "The writer refused: <no>." });
    expect(result.nativeHtml).toContain("The writer refused: &lt;no&gt;.");
  });
});

describe("replayArticleReader", () => {
  const [planner, laundry] = SAMPLE_APPROVED.headlines;

  it("reads every feature story from the web, with no saved copies, and keeps each outcome without the text", async () => {
    const web = fakeWeb({
      [planner.url]: htmlPage(prose("planner")),
      [laundry.url]: htmlPage("Forbidden", 403),
      [jinaUrl(laundry.url)]: jinaError(451, "Unavailable for legal reasons"),
    });
    const reader = replayArticleReader({ read: true, env: { JINA_API_KEY: "jina-test-key" }, readOptions: { fetch: web.fetch } });

    const articles = await reader.readArticles([planner, laundry]);

    expect(articles).toEqual([
      { storyId: planner.id, text: expect.stringContaining("planner pretend lab") },
      { storyId: laundry.id, unread: true },
    ]);
    expect(reader.reads().map((read) => [read.storyId, read.status, read.method, read.reused])).toEqual([
      [planner.id, "read", "fetch", false],
      [laundry.id, "blocked", null, false],
    ]);
    expect(JSON.stringify(reader.reads())).not.toContain("planner pretend lab");
    const jinaCall = web.fetch.mock.calls.find(([url]) => url === jinaUrl(laundry.url)) as [string, { headers: Record<string, string> }];
    expect(jinaCall[1].headers.Authorization).toBe("Bearer jina-test-key");
  });

  it("reads nothing with --no-read", async () => {
    const reader = replayArticleReader({ read: false, env: {} });

    await expect(reader.readArticles([planner])).resolves.toEqual([{ storyId: planner.id, unread: true }]);
    expect(reader.reads()).toEqual([]);
  });
});

describe("renderReplayIndex", () => {
  it("puts each date's two emails side by side, escaped", () => {
    const report = { date: "2027-01-04", status: "failed", failedStep: "validate", problems: ["Bad <b>"], title: { native: "A & B", n8n: "C" } };

    const html = renderReplayIndex([report as unknown as ReplayReport]);

    expect(html).toContain('<iframe src="2027-01-04.native.html"');
    expect(html).toContain('<iframe src="2027-01-04.n8n.html"');
    expect(html).toContain("A &amp; B");
    expect(html).toContain("Bad &lt;b&gt;");
  });

  it("names the steps it timed and whose images they are, with no GHL step", () => {
    const html = renderReplayIndex([]);

    expect(html).toContain("<p>Steps timed: read_articles, write, validate, image, html. Images are n8n's.</p>");
    expect(html).not.toMatch(/ghl/i);
  });
});
