import type {
  FeatureStory,
  HighlightBullet,
  QuickHit,
  ToolItem,
  WrittenIssueContent,
} from "@/src/pipeline/draft/content";

/**
 * The issue email, ported from n8n's "Build Clean HTML Email" (docs/n8n-backend/20-drafting-and-images.md
 * §1.7.2). Same markup and whitespace, so the distribution service and publish detection see what they always have. Changes:
 * - the issue wrapper also carries `data-draft-id`, and a staged email carries `data-version-id` too, so publish
 *   detection knows which staged version was sent (the draft's own HTML, the preview in the app, has no version id);
 * - the footer year comes from the issue date (n8n hardcoded 2026);
 * - the title comes from the written content, and an invalid issue date throws instead of printing today;
 * - the image block is left out when there is no image (n8n always printed one).
 * `data-issue-id`, `data-story-id`, and `data-src-url` are a contract with src/pipeline/publish/sent-email-parser.ts.
 */

export interface EmailIssue {
  id: number;
  /** YYYY-MM-DD */
  issueDate: string;
}

export interface EmailDraft {
  id: number;
  /** The featured image's own URL (S3). The email loads it through the site's image CDN. */
  featuredImageUrl: string;
  /** Set only on a staged email (#149): the staged version's id, written as `data-version-id`. */
  versionId?: number;
}

const IMAGE_CDN = "https://airecap.news/.netlify/images?w=600&q=70&url=";

/** The image URL the email shows. Not URL-encoded, exactly like n8n's template. */
export function emailImageUrl(featuredImageUrl: string): string {
  return featuredImageUrl ? IMAGE_CDN + featuredImageUrl : "";
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function stripEmoji(value: unknown): string {
  return String(value ?? "")
    .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseIssueDate(issueDate: string): Date {
  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(issueDate) ? new Date(`${issueDate}T00:00:00.000Z`) : null;
  if (!parsed || Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== issueDate) {
    throw new Error(`Issue date "${issueDate}" is not a YYYY-MM-DD date.`);
  }
  return parsed;
}

function formatIssueDate(date: Date): string {
  return date.toLocaleDateString("en-US", {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

function getStoryWrapperAttrs(story: { story_id: number; url: string }): string {
  return `data-story-id="${escapeAttr(story.story_id)}" data-src-url="${escapeAttr(story.url || "")}"`;
}

// Template literals below keep n8n's exact whitespace; the tests compare the output with n8n's byte for byte.

function renderSectionHeader(label: string): string {
  return `
    <div style="font-size: 17px; font-weight: 700; color: #78716c; margin-bottom: 24px; padding-bottom: 14px; border-bottom: 2px solid #e7e5e4; text-transform: uppercase; letter-spacing: 1.5px;">
      ${escapeHtml(label)}
    </div>
  `;
}

function renderOverview(summary: string): string {
  const safeSummary = normalizeText(summary);
  if (!safeSummary) return "";

  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; background: #fafaf9; padding: 28px;">
      <div style="font-size: 17px; font-weight: 700; color: #78716c; margin-bottom: 20px; padding-bottom: 14px; border-bottom: 2px solid #e7e5e4; text-transform: uppercase;">
        📋 Today's Overview
      </div>
      <div style="font-size: 17px; line-height: 1.8; color: #44403c; margin-bottom: 0;">
        ${escapeHtml(safeSummary)}
      </div>
    </div>
  `;
}

function renderHighlightBullet(bullet: HighlightBullet): string {
  const before = normalizeText(bullet.before);
  const highlight = normalizeText(bullet.highlight);
  const after = normalizeText(bullet.after);

  if (!before && !highlight && !after) return "";

  const content =
    `${before ? escapeHtml(before) : ""}` +
    `${before && highlight ? " " : ""}` +
    `${highlight ? `<strong>${escapeHtml(highlight)}</strong>` : ""}` +
    `${highlight && after ? " " : ""}` +
    `${after ? escapeHtml(after) : ""}`;

  return `
    <table width="100%" border="0" cellspacing="0" cellpadding="0" style="margin-bottom: 8px;">
      <tr>
        <td width="30" style="vertical-align: top; line-height: 1;">
          <span style="font-size: 30px;">•</span>
        </td>
        <td style="vertical-align: top; padding-top: 7px; font-size: 15px; line-height: 1.5; color: #44403c;">
          ${content}
        </td>
      </tr>
    </table>
  `;
}

function renderFeatureStory(story: FeatureStory, isLast: boolean): string {
  const headline = normalizeText(story.headline);
  const storyDetail = normalizeText(story.story_detail);
  const bullets = story.bullets;

  return `
    <div ${getStoryWrapperAttrs(story)} style="margin-bottom: ${isLast ? "0" : "40px"};">
      <div style="font-size: 16px; font-weight: 700; color: #1c1917; margin-bottom: 6px; line-height: 1.7;">
        ${escapeHtml(headline)}
      </div>

      ${storyDetail ? `
        <div style="font-size: 14px; line-height: 1.7; color: #57534e; margin-bottom: 16px;">
          ${escapeHtml(storyDetail)}
        </div>
      ` : ""}

      ${bullets.length ? `
        <div style="margin-top: 16px; padding-left: 0;">
          ${bullets.map(renderHighlightBullet).join("\n")}
        </div>
      ` : ""}

      ${story.url ? `
        <div style="margin-top: 16px;">
          <a
            href="${escapeAttr(story.url)}"
            style="color: #B7410E; font-weight: 600; font-size: 14px; text-decoration: none; border-bottom: 2px solid #B7410E; display: inline-block;"
          >
            Read more →
          </a>
        </div>
      ` : ""}
    </div>
  `;
}

function renderFeatureSection(label: string, stories: FeatureStory[]): string {
  if (stories.length === 0) return "";

  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 28px; background: #fafaf9;">
      ${renderSectionHeader(label)}
      ${stories.map((story, idx) => renderFeatureStory(story, idx === stories.length - 1)).join("\n")}
    </div>
  `;
}

function renderToolsSection(items: ToolItem[]): string {
  if (items.length === 0) return "";

  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; background: #fafaf9; padding: 28px;">
      ${renderSectionHeader("🛠️ Trending AI Tools")}
      <ul style="margin: 0; padding-left: 0; list-style-type: none;">
        ${items.map((tool, idx) => {
          const isLast = idx === items.length - 1;
          const linkText = normalizeText(tool.link_text);
          const detail = normalizeText(tool.detail);

          return `
            <li ${getStoryWrapperAttrs(tool)} style="margin-bottom: ${isLast ? "0" : "8px"};">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="30" style="vertical-align: top; line-height: 1.5;">
                    <span style="font-size: 30px;">•</span>
                  </td>
                  <td style="vertical-align: top; padding-top: 7px; font-size: 15px; color: #44403c; line-height: 1.5;">
                    <a
                      href="${escapeAttr(tool.url || "#")}"
                      style="color: #B7410E; font-weight: 700; text-decoration: none; border-bottom: 2px solid #B7410E;"
                    >
                      ${escapeHtml(linkText)}
                    </a>${detail ? ` - ${escapeHtml(detail)}` : ""}
                  </td>
                </tr>
              </table>
            </li>
          `;
        }).join("\n")}
      </ul>
    </div>
  `;
}

function renderQuickHitsSection(items: QuickHit[]): string {
  if (items.length === 0) return "";

  return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; background: #fafaf9; padding: 32px;">
      ${renderSectionHeader("⚡ QUICK HITS")}
      ${items.map((hit, idx) => {
        const isLast = idx === items.length - 1;
        const linkText = normalizeText(hit.link_text);
        const text = normalizeText(hit.text);

        return `
          <div
            ${getStoryWrapperAttrs(hit)}
            style="padding: 12px 0; border-bottom: ${isLast ? "none" : "1px solid #e7e5e4"}; font-size: 15px; line-height: 1.7; color: #44403c;"
          >
            <a
              href="${escapeAttr(hit.url || "#")}"
              style="color: #B7410E; font-weight: 700; text-decoration: none; border-bottom: 2px solid #B7410E;"
            >
              ${escapeHtml(linkText)}
            </a>${text ? ` ${escapeHtml(text)}` : ""}
          </div>
        `;
      }).join("\n")}
    </div>
  `;
}

export function renderIssueEmailHtml(content: WrittenIssueContent, issue: EmailIssue, draft: EmailDraft): string {
  const issueDate = parseIssueDate(issue.issueDate);
  const formattedDate = formatIssueDate(issueDate);
  const footerYear = issueDate.getUTCFullYear();
  const featureImageUrl = emailImageUrl(draft.featuredImageUrl);
  const executiveSummary = normalizeText(content.overview.summary || "Your daily AI intelligence briefing.");
  const headerTitle = stripEmoji(content.title) || "AI Recap";
  const versionAttr = draft.versionId === undefined ? "" : `\n      data-version-id="${escapeAttr(draft.versionId)}"`;

  return `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div
      data-issue-id="${escapeAttr(issue.id)}"
      data-draft-id="${escapeAttr(draft.id)}"${versionAttr}
      style="max-width: 680px; margin: 0 auto; padding: 40px 20px;"
    >
      <div style="text-align: center; margin-bottom: 32px;">
        <div style="display: inline-block; background: #78716c; color: white; padding: 8px 20px; border-radius: 20px; font-size: 12px; font-weight: 700; margin-bottom: 16px;">
          AI Recap
        </div>

        <div style="font-size: 42px; font-weight: 800; color: #1c1917; margin-bottom: 8px; line-height: 1.15;">
          ${escapeHtml(headerTitle)}
        </div>

        <div style="font-size: 16px; color: #78716c;">
          Hello {{contact.first_name}}, here's your briefing for ${escapeHtml(formattedDate)}
        </div>
      </div>

      ${featureImageUrl ? `
        <div style="margin-bottom: 32px; text-align: center;">
          <img
            src="${escapeAttr(featureImageUrl)}"
            width="600"
            style="width: 100%; max-width: 600px; height: auto; border-radius: 8px;"
          />
        </div>
      ` : ""}

      ${renderOverview(executiveSummary)}
      ${renderFeatureSection("🔥 Top Stories", content.headlines)}
      ${renderFeatureSection("🔬 Research & Analysis", content.research_and_analysis)}
      ${renderToolsSection(content.tools)}
      ${renderQuickHitsSection(content.quick_hits)}

      <div style="text-align: center; color: #a8a29e; font-size: 12px; margin-top: 40px; border-top: 1px solid #e7e5e4; padding-top: 20px; line-height: 1.7;">
        <div style="margin-bottom: 8px;">© AI Recap ${footerYear}</div>
        <div style="margin-bottom: 6px;">
          You’re receiving this because you subscribed to AI Recap.
        </div>
       
      </div>
    </div>
  </body>
</html>
`.trim();
}
