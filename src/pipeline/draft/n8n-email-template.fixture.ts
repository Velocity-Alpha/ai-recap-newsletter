/**
 * Test helper: n8n's "Build Clean HTML Email" code node (docs/n8n-backend/20-drafting-and-images.md §1.7.2),
 * kept as close to the original as TypeScript allows. Its inputs (`$('Merge')` and the inserted issue row)
 * become arguments. Tests compare the native template with it.
 */

interface N8nBullet {
  before?: string;
  highlight?: string;
  after?: string;
}

interface N8nStory {
  story_id?: string | number;
  url?: string;
  headline?: string;
  story_detail?: string;
  bullets?: N8nBullet[] | null;
  link_text?: string;
  detail?: string;
  text?: string;
}

export interface N8nTemplateInput {
  /** `$('Merge').first().json` */
  merge: {
    s3_image_url: string;
    structured_issue_data: {
      overview?: { summary?: string };
      headlines?: N8nStory[];
      research_and_analysis?: N8nStory[];
      tools?: N8nStory[];
      quick_hits?: N8nStory[];
    };
  };
  /** `$input.first().json`: the inserted `newsletter.issues` row. */
  issueDbRow: { id: number; title: string; issue_date: string };
}

export function renderN8nIssueEmail({ merge, issueDbRow }: N8nTemplateInput): string {
  const input = merge;

  const issueId = issueDbRow.id;
  const issueTitle = issueDbRow.title;
  const issueDate = issueDbRow.issue_date;
  const featureImageUrl =
    'https://airecap.news/.netlify/images?w=600&q=70&url=' + input.s3_image_url;

  const structured = input.structured_issue_data || {};

  const overview = structured.overview || {};
  const headlines = Array.isArray(structured.headlines) ? structured.headlines : [];
  const researchAndAnalysis = Array.isArray(structured.research_and_analysis)
    ? structured.research_and_analysis
    : [];
  const tools = Array.isArray(structured.tools) ? structured.tools : [];
  const quickHits = Array.isArray(structured.quick_hits) ? structured.quick_hits : [];

  function escapeHtml(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function escapeAttr(value: unknown) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function normalizeText(value: unknown) {
    return String(value ?? '').replace(/\s+/g, ' ').trim();
  }

  function stripEmoji(value: unknown) {
    return String(value ?? '')
      .replace(/[\p{Extended_Pictographic}\p{Emoji_Presentation}]/gu, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function formatIssueDate(value: string) {
    const fallback = new Date().toISOString();
    const safeValue = value || fallback;
    const parsed = new Date(safeValue);

    if (Number.isNaN(parsed.getTime())) {
      return new Date().toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      });
    }

    return parsed.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
  }

  function getStoryWrapperAttrs(story: N8nStory) {
    return `data-story-id="${escapeAttr(story?.story_id || '')}" data-src-url="${escapeAttr(story?.url || '')}"`;
  }

  function renderSectionHeader(label: string) {
    return `
    <div style="font-size: 17px; font-weight: 700; color: #78716c; margin-bottom: 24px; padding-bottom: 14px; border-bottom: 2px solid #e7e5e4; text-transform: uppercase; letter-spacing: 1.5px;">
      ${escapeHtml(label)}
    </div>
  `;
  }

  function renderOverview(summary: string) {
    const safeSummary = normalizeText(summary);
    if (!safeSummary) return '';

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

  function renderHighlightBullet(bullet: N8nBullet) {
    if (!bullet) return '';

    const before = normalizeText(bullet.before);
    const highlight = normalizeText(bullet.highlight);
    const after = normalizeText(bullet.after);

    if (!before && !highlight && !after) return '';

    const content =
      `${before ? escapeHtml(before) : ''}` +
      `${before && highlight ? ' ' : ''}` +
      `${highlight ? `<strong>${escapeHtml(highlight)}</strong>` : ''}` +
      `${highlight && after ? ' ' : ''}` +
      `${after ? escapeHtml(after) : ''}`;

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

  function renderFeatureStory(story: N8nStory, isLast: boolean) {
    const headline = normalizeText(story.headline);
    const storyDetail = normalizeText(story.story_detail);
    const bullets = Array.isArray(story.bullets) ? story.bullets : [];

    return `
    <div ${getStoryWrapperAttrs(story)} style="margin-bottom: ${isLast ? '0' : '40px'};">
      <div style="font-size: 16px; font-weight: 700; color: #1c1917; margin-bottom: 6px; line-height: 1.7;">
        ${escapeHtml(headline)}
      </div>

      ${storyDetail ? `
        <div style="font-size: 14px; line-height: 1.7; color: #57534e; margin-bottom: 16px;">
          ${escapeHtml(storyDetail)}
        </div>
      ` : ''}

      ${bullets.length ? `
        <div style="margin-top: 16px; padding-left: 0;">
          ${bullets.map(renderHighlightBullet).join('\n')}
        </div>
      ` : ''}

      ${story.url ? `
        <div style="margin-top: 16px;">
          <a
            href="${escapeAttr(story.url)}"
            style="color: #B7410E; font-weight: 600; font-size: 14px; text-decoration: none; border-bottom: 2px solid #B7410E; display: inline-block;"
          >
            Read more →
          </a>
        </div>
      ` : ''}
    </div>
  `;
  }

  function renderFeatureSection(label: string, stories: N8nStory[]) {
    if (!Array.isArray(stories) || stories.length === 0) return '';

    return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; padding: 28px; background: #fafaf9;">
      ${renderSectionHeader(label)}
      ${stories.map((story, idx) => renderFeatureStory(story, idx === stories.length - 1)).join('\n')}
    </div>
  `;
  }

  function renderToolsSection(items: N8nStory[]) {
    if (!Array.isArray(items) || items.length === 0) return '';

    return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; background: #fafaf9; padding: 28px;">
      ${renderSectionHeader('🛠️ Trending AI Tools')}
      <ul style="margin: 0; padding-left: 0; list-style-type: none;">
        ${items.map((tool, idx) => {
          const isLast = idx === items.length - 1;
          const linkText = normalizeText(tool.link_text);
          const detail = normalizeText(tool.detail);

          return `
            <li ${getStoryWrapperAttrs(tool)} style="margin-bottom: ${isLast ? '0' : '8px'};">
              <table width="100%" border="0" cellspacing="0" cellpadding="0">
                <tr>
                  <td width="30" style="vertical-align: top; line-height: 1.5;">
                    <span style="font-size: 30px;">•</span>
                  </td>
                  <td style="vertical-align: top; padding-top: 7px; font-size: 15px; color: #44403c; line-height: 1.5;">
                    <a
                      href="${escapeAttr(tool.url || '#')}"
                      style="color: #B7410E; font-weight: 700; text-decoration: none; border-bottom: 2px solid #B7410E;"
                    >
                      ${escapeHtml(linkText)}
                    </a>${detail ? ` - ${escapeHtml(detail)}` : ''}
                  </td>
                </tr>
              </table>
            </li>
          `;
        }).join('\n')}
      </ul>
    </div>
  `;
  }

  function renderQuickHitsSection(items: N8nStory[]) {
    if (!Array.isArray(items) || items.length === 0) return '';

    return `
    <div style="border: 2px solid #e7e5e4; border-radius: 12px; margin-bottom: 28px; background: #fafaf9; padding: 32px;">
      ${renderSectionHeader('⚡ QUICK HITS')}
      ${items.map((hit, idx) => {
        const isLast = idx === items.length - 1;
        const linkText = normalizeText(hit.link_text);
        const text = normalizeText(hit.text);

        return `
          <div
            ${getStoryWrapperAttrs(hit)}
            style="padding: 12px 0; border-bottom: ${isLast ? 'none' : '1px solid #e7e5e4'}; font-size: 15px; line-height: 1.7; color: #44403c;"
          >
            <a
              href="${escapeAttr(hit.url || '#')}"
              style="color: #B7410E; font-weight: 700; text-decoration: none; border-bottom: 2px solid #B7410E;"
            >
              ${escapeHtml(linkText)}
            </a>${text ? ` ${escapeHtml(text)}` : ''}
          </div>
        `;
      }).join('\n')}
    </div>
  `;
  }

  const formattedDate = formatIssueDate(issueDate);
  const executiveSummary = normalizeText(
    overview.summary || 'Your daily AI intelligence briefing.'
  );
  const headerTitle = stripEmoji(issueTitle) || 'AI Recap';

  const html = `
<!DOCTYPE html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
  </head>
  <body style="margin: 0; padding: 0; background-color: #ffffff; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
    <div
      data-issue-id="${escapeAttr(issueId)}"
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
      ` : ''}

      ${renderOverview(executiveSummary)}
      ${renderFeatureSection('🔥 Top Stories', headlines)}
      ${renderFeatureSection('🔬 Research & Analysis', researchAndAnalysis)}
      ${renderToolsSection(tools)}
      ${renderQuickHitsSection(quickHits)}

      <div style="text-align: center; color: #a8a29e; font-size: 12px; margin-top: 40px; border-top: 1px solid #e7e5e4; padding-top: 20px; line-height: 1.7;">
        <div style="margin-bottom: 8px;">© AI Recap 2026</div>
        <div style="margin-bottom: 6px;">
          You’re receiving this because you subscribed to AI Recap.
        </div>
       
      </div>
    </div>
  </body>
</html>
`.trim();

  return html;
}
