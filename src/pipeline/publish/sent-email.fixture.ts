/**
 * Test helper: renders an issue email the way n8n's "Build Clean HTML Email" node does, optionally with
 * the changes GHL and Mailgun make before it reaches the seed inbox. Fixtures use placeholder text only.
 */

export interface FixtureBullet {
  before?: string;
  highlight?: string;
  after?: string;
}

export interface FixtureFeatureStory {
  story_id: number;
  url: string;
  headline: string;
  story_detail?: string;
  bullets?: FixtureBullet[];
}

export interface FixtureLinkItem {
  story_id: number;
  url: string;
  link_text: string;
  detail?: string;
  text?: string;
}

export interface FixtureIssue {
  issueId: number;
  title: string;
  issueDate: string;
  imageUrl?: string;
  summary?: string;
  headlines?: FixtureFeatureStory[];
  research?: FixtureFeatureStory[];
  tools?: FixtureLinkItem[];
  quickHits?: FixtureLinkItem[];
}

export interface RenderOptions {
  /** Apply what GHL and Mailgun do to the received copy. */
  received?: boolean;
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeAttr(value: string): string {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function stripEmoji(value: string): string {
  return value
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatIssueDate(value: string): string {
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function wrapperAttrs(story: { story_id: number; url: string }): string {
  return `data-story-id="${escapeAttr(String(story.story_id))}" data-src-url="${escapeAttr(story.url)}"`;
}

function sectionHeader(label: string): string {
  return `
    <div style="font-size: 17px; font-weight: 700; color: #78716c; margin-bottom: 24px; text-transform: uppercase;">
      ${escapeHtml(label)}
    </div>`;
}

function bullet(b: FixtureBullet): string {
  const before = b.before ?? "";
  const highlight = b.highlight ?? "";
  const after = b.after ?? "";
  const content =
    (before ? escapeHtml(before) : "") +
    (before && highlight ? " " : "") +
    (highlight ? `<strong>${escapeHtml(highlight)}</strong>` : "") +
    (highlight && after ? " " : "") +
    (after ? escapeHtml(after) : "");
  return `
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px;">
      <tr>
        <td width="30" style="vertical-align: top; line-height: 1;">
          <span style="font-size: 30px;">•</span>
        </td>
        <td style="vertical-align: top; padding-top: 7px; font-size: 15px;">
          ${content}
        </td>
      </tr>
    </table>`;
}

function featureStory(story: FixtureFeatureStory, isLast: boolean): string {
  const bullets = story.bullets ?? [];
  return `
    <div ${wrapperAttrs(story)} style="margin-bottom: ${isLast ? "0" : "40px"};">
      <div style="font-size: 16px; font-weight: 700; color: #1c1917;">
        ${escapeHtml(story.headline)}
      </div>
      ${story.story_detail ? `
        <div style="font-size: 14px; line-height: 1.7; color: #57534e;">
          ${escapeHtml(story.story_detail)}
        </div>` : ""}
      ${bullets.length ? `
        <div style="margin-top: 16px; padding-left: 0;">
          ${bullets.map(bullet).join("\n")}
        </div>` : ""}
      ${story.url ? `
        <div style="margin-top: 16px;">
          <a href="${escapeAttr(story.url)}" style="color: #B7410E;">
            Read more →
          </a>
        </div>` : ""}
    </div>`;
}

function featureSection(label: string, stories: FixtureFeatureStory[] | undefined): string {
  if (!stories?.length) return "";
  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 28px;">
      ${sectionHeader(label)}
      ${stories.map((story, idx) => featureStory(story, idx === stories.length - 1)).join("\n")}
    </div>`;
}

function toolsSection(items: FixtureLinkItem[] | undefined): string {
  if (!items?.length) return "";
  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 28px;">
      ${sectionHeader("🛠️ Trending AI Tools")}
      <ul style="margin: 0; padding-left: 0; list-style-type: none;">
        ${items
          .map(
            (tool) => `
            <li ${wrapperAttrs(tool)} style="margin-bottom: 8px;">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="30" style="vertical-align: top;"><span style="font-size: 30px;">•</span></td>
                  <td style="vertical-align: top; padding-top: 7px;">
                    <a
                      href="${escapeAttr(tool.url || "#")}"
                      style="color: #B7410E; font-weight: 700;"
                    >
                      ${escapeHtml(tool.link_text)}
                    </a>${tool.detail ? ` - ${escapeHtml(tool.detail)}` : ""}
                  </td>
                </tr>
              </table>
            </li>`
          )
          .join("\n")}
      </ul>
    </div>`;
}

function quickHitsSection(items: FixtureLinkItem[] | undefined): string {
  if (!items?.length) return "";
  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 32px;">
      ${sectionHeader("⚡ QUICK HITS")}
      ${items
        .map(
          (hit) => `
          <div
            ${wrapperAttrs(hit)}
            style="padding: 12px 0; font-size: 15px;"
          >
            <a
              href="${escapeAttr(hit.url || "#")}"
              style="color: #B7410E; font-weight: 700;"
            >
              ${escapeHtml(hit.link_text)}
            </a>${hit.text ? ` ${escapeHtml(hit.text)}` : ""}
          </div>`
        )
        .join("\n")}
    </div>`;
}

export function renderIssueEmail(issue: FixtureIssue, options: RenderOptions = {}): string {
  const imageUrl = issue.imageUrl
    ? `https://airecap.news/.netlify/images?w=600&q=70&url=${issue.imageUrl}`
    : "";
  const summary = issue.summary?.trim() ?? "";

  let html = `
<!DOCTYPE html>
<html>
  <head><meta charset="utf-8"></head>
  <body style="margin: 0; padding: 0;">
    <div
      data-issue-id="${escapeAttr(String(issue.issueId))}"
      style="max-width: 680px; margin: 0 auto; padding: 40px 20px;"
    >
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; background: #78716c; color: white;">
          AI Recap
        </div>

        <div style="font-size: 42px; font-weight: 800; color: #1c1917;">
          ${escapeHtml(stripEmoji(issue.title))}
        </div>

        <div style="font-size: 16px; color: #78716c;">
          Hello {{contact.first_name}}, here's your briefing for ${escapeHtml(formatIssueDate(issue.issueDate))}
        </div>
      </div>

      ${imageUrl ? `
        <div style="margin-bottom: 32px; text-align: center;">
          <img
            src="${escapeAttr(imageUrl)}"
            width="600"
            style="width: 100%; max-width: 600px; height: auto;"
          />
        </div>` : ""}

      ${summary ? `
      <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 28px;">
        <div style="font-size: 17px; font-weight: 700; color: #78716c; text-transform: uppercase;">
          📋 Today's Overview
        </div>
        <div style="font-size: 17px; line-height: 1.8; color: #44403c; margin-bottom: 0;">
          ${escapeHtml(summary)}
        </div>
      </div>` : ""}
      ${featureSection("🔥 Top Stories", issue.headlines)}
      ${featureSection("🔬 Research & Analysis", issue.research)}
      ${toolsSection(issue.tools)}
      ${quickHitsSection(issue.quickHits)}

      <div style="text-align: center; color: #a8a29e; font-size: 12px; margin-top: 40px;">
        <div style="margin-bottom: 8px;">© AI Recap 2026</div>
        <div style="margin-bottom: 6px;">You’re receiving this because you subscribed to AI Recap.</div>
      </div>
    </div>
  </body>
</html>`.trim();

  if (options.received) {
    let link = 0;
    html = html
      .replace("{{contact.first_name}}", "Reader")
      // GHL adds a hidden preview line right after <body>.
      .replace(
        /<body([^>]*)>/,
        '<body$1><div style="display:none;font-size:1px;max-height:0px;overflow:hidden;">Preview text</div>'
      )
      // Mailgun rewrites every link to a tracking redirect.
      .replace(/href="[^"]*"/g, () => `href="https://email.mg.example.test/c/track-${(link += 1)}"`)
      // GHL wraps link text in Outlook-only comments.
      .replace(/(<a\b[^>]*>)/g, '$1<!--[if mso]><font color="#B7410E"><![endif]-->')
      .replace(/<\/a>/g, "<!--[if mso]></font><![endif]--></a>")
      // The HTML serializer adds tbody around table rows.
      .replace(/<table([^>]*)>/g, "<table$1><tbody>")
      .replace(/<\/table>/g, "</tbody></table>")
      // Appended GHL footer with an unsubscribe link outside the issue wrapper.
      .replace(
        "</body>",
        '<div><a href="https://services.example.test/unsubscribe/abc">Unsubscribe</a></div></body>'
      );
  }

  return html;
}

/** A complete placeholder issue that covers every section. */
export const PLACEHOLDER_ISSUE: FixtureIssue = {
  issueId: 268,
  title: "♊️ Placeholder Title For Tests",
  issueDate: "2026-11-03",
  imageUrl: "https://assets.example.test/newsletter/hero-2026-11-03.jpeg",
  summary: "Good morning, placeholder overview & summary text. Let's dive in.",
  headlines: [
    {
      story_id: 11023,
      url: "https://news.example.test/story-a?ref=feed&id=1",
      headline: "Headline A",
      story_detail: "Detail A explains the placeholder story.",
      bullets: [
        { before: "First bullet starts", highlight: "with a highlight", after: "and ends here." },
        { before: "Second bullet has", highlight: "Highlight B2" , after: ", then punctuation." },
      ],
    },
    {
      story_id: 11007,
      url: "https://news.example.test/story-b",
      headline: "Headline B",
      story_detail: "Detail B.",
      bullets: [{ highlight: "Only a highlight", after: "follows." }],
    },
  ],
  research: [
    {
      story_id: 10996,
      url: "https://papers.example.test/abs/1234",
      headline: "Paper C",
      story_detail: "Detail C.",
      bullets: [{ before: "Paper bullet", highlight: "key result", after: "for research." }],
    },
  ],
  tools: [
    { story_id: 11009, url: "https://tools.example.test/d", link_text: "Tool D", detail: "does D - well." },
    { story_id: 11010, url: "https://tools.example.test/e", link_text: "Tool E" },
  ],
  quickHits: [
    { story_id: 10998, url: "https://hits.example.test/f", link_text: "Hit F", text: "says F." },
  ],
};
