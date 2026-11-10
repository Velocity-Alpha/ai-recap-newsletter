import { describe, expect, it } from "vitest";

import { toIssueContentJson } from "@/src/pipeline/draft/content";
import { SAMPLE_CONTENT, SAMPLE_DRAFT, SAMPLE_ISSUE } from "@/src/pipeline/draft/draft.fixture";
import { emailImageUrl, renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import { renderN8nIssueEmail } from "@/src/pipeline/draft/n8n-email-template.fixture";
import { parseSentEmail } from "@/src/pipeline/publish/sent-email-parser";
import { asReceivedCopy } from "@/src/pipeline/publish/sent-email.fixture";

function n8nHtml(issueDate: string): string {
  return renderN8nIssueEmail({
    merge: { s3_image_url: SAMPLE_DRAFT.featuredImageUrl, structured_issue_data: SAMPLE_CONTENT },
    issueDbRow: { id: SAMPLE_ISSUE.id, title: SAMPLE_CONTENT.title, issue_date: issueDate },
  });
}

describe("renderIssueEmailHtml", () => {
  it("matches n8n's template apart from the draft id and the footer year", () => {
    const html = renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, SAMPLE_DRAFT);

    const expected = n8nHtml(SAMPLE_ISSUE.issueDate)
      .replace('data-issue-id="301"\n', 'data-issue-id="301"\n      data-draft-id="41"\n')
      .replace("© AI Recap 2026", "© AI Recap 2027");
    expect(html).toBe(expected);
  });

  it("is n8n's output exactly, plus the draft id, for an issue dated 2026", () => {
    const issue = { ...SAMPLE_ISSUE, issueDate: "2026-11-09" };

    const html = renderIssueEmailHtml(SAMPLE_CONTENT, issue, SAMPLE_DRAFT);

    expect(html.replace('      data-draft-id="41"\n', "")).toBe(n8nHtml("2026-11-09"));
    expect(html).toContain("here's your briefing for Monday, November 9, 2026");
    expect(html).toContain("© AI Recap 2026");
  });

  it("keeps the ids publish detection reads", () => {
    const html = renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, SAMPLE_DRAFT);

    expect(html).toContain('data-issue-id="301"');
    expect(html).toContain('data-draft-id="41"');
    expect(html).toContain('data-story-id="501" data-src-url="https://news.example.test/planner?ref=feed&amp;id=1"');
    expect(html).toContain('data-story-id="508" data-src-url="https://hits.example.test/rules"');
    expect(html).toContain(
      'src="https://airecap.news/.netlify/images?w=600&amp;q=70&amp;url=https://assets.example.test/newsletter/2027-01-04-abc.jpg"'
    );
  });

  it("has no version id in the draft's own HTML", () => {
    expect(renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, SAMPLE_DRAFT)).not.toContain("data-version-id");
  });

  it("adds only the staged version's id to a staged email", () => {
    const html = renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, { ...SAMPLE_DRAFT, versionId: 93 });

    expect(html.replace('      data-version-id="93"\n', "")).toBe(renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, SAMPLE_DRAFT));
    expect(parseSentEmail(asReceivedCopy(html))).toMatchObject({ versionId: 93, draftId: 41, problems: [] });
  });

  it("escapes text and leaves out the image when there is none", () => {
    const content = structuredClone(SAMPLE_CONTENT);
    content.headlines[0].headline = "Tags <b>stay</b> text";

    const html = renderIssueEmailHtml(content, SAMPLE_ISSUE, { ...SAMPLE_DRAFT, featuredImageUrl: "" });

    expect(html).toContain("Tags &lt;b&gt;stay&lt;/b&gt; text");
    expect(html).not.toContain("<img");
  });

  it("rejects an issue date that is not YYYY-MM-DD", () => {
    expect(() => renderIssueEmailHtml(SAMPLE_CONTENT, { ...SAMPLE_ISSUE, issueDate: "next Monday" }, SAMPLE_DRAFT)).toThrow(
      'Issue date "next Monday" is not a YYYY-MM-DD date.'
    );
  });
});

describe("publish detection on the native email", () => {
  const html = renderIssueEmailHtml(SAMPLE_CONTENT, SAMPLE_ISSUE, SAMPLE_DRAFT);
  const expectedContent = toIssueContentJson(SAMPLE_CONTENT, {
    issueId: SAMPLE_ISSUE.id,
    issueDate: SAMPLE_ISSUE.issueDate,
    featuredImageUrl: emailImageUrl(SAMPLE_DRAFT.featuredImageUrl),
  });

  it("rebuilds the draft's content_json, story ids, and draft id from the template HTML", () => {
    const parsed = parseSentEmail(html);

    expect(parsed?.content).toEqual(expectedContent);
    expect(parsed?.storyIds).toEqual([501, 502, 503, 504, 505, 506, 507, 508]);
    expect(parsed?.draftId).toBe(41);
    expect(parsed?.problems).toEqual([]);
  });

  it("reads the same from the copy that reaches the seed inbox", () => {
    const parsed = parseSentEmail(asReceivedCopy(html));

    expect(parsed?.content).toEqual(expectedContent);
    expect(parsed?.draftId).toBe(41);
    expect(parsed?.problems).toEqual([]);
  });
});
