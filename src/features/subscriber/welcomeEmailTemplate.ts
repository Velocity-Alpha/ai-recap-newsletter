export function buildSubscriberWelcomeEmail(siteUrl: string) {
  return {
  subject: "Welcome to AI Recap",
  html: `
    <div style="display:none;font-size:1px;color:#ffffff;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">
      You've successfully subscribed to AI Recap!
    </div>
    <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#ffffff;">
      <tr>
        <td align="center" style="padding:36px 20px;">
          <table width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;width:100%;">
            <tr>
              <td style="padding-bottom:24px;">
                <p style="margin:0;font-size:12px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:1.4px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">AI Recap</p>
                <p style="margin:10px 0 0 0;font-size:28px;line-height:1.2;font-weight:800;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Hey 👋</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:24px;">
                <p style="margin:0 0 12px 0;font-size:15px;line-height:1.7;color:#44403c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">I'm Borna. AI Recap is a quick daily briefing on what actually matters in AI.</p>
                <p style="margin:0;font-size:15px;line-height:1.7;color:#44403c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Models. Research. Launches. Major moves. Delivered in ~3 minutes.</p>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:28px;">
                <table width="100%" cellpadding="0" cellspacing="0" border="0" style="border:1px solid #e7e5e4;border-radius:10px;background-color:#fafaf9;">
                  <tr>
                    <td style="padding:24px;">
                      <p style="margin:0 0 10px 0;font-size:13px;font-weight:700;color:#78716c;text-transform:uppercase;letter-spacing:1px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Before your first briefing</p>
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#44403c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Before the first issue arrives tomorrow, take 10 seconds to make sure it lands in the right place.</p>
                      <p style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">1. Confirm you're human</p>
                      <p style="margin:0 0 16px 0;font-size:15px;line-height:1.6;color:#57534e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Click below and send the prewritten email. This helps keep AI Recap out of spam.</p>
                      <table cellpadding="0" cellspacing="0" border="0" style="margin-bottom:22px;">
                        <tr>
                          <td style="background-color:#78716c;border-radius:6px;">
                            <a href="mailto:hello@updates.airecap.news?subject=AI%20Recap&body=Hey%20Borna%2C%20I%27m%20human." style="display:inline-block;padding:12px 22px;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">CONFIRM EMAIL</a>
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 6px 0;font-size:15px;font-weight:700;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">2. Move this email to your main inbox</p>
                      <p style="margin:0 0 18px 0;font-size:15px;line-height:1.6;color:#57534e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">If this landed in <strong>Promotions, Spam, or Other</strong>, move it now so future issues show up where you'll actually see them.</p>
                      <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Gmail</p>
                      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#57534e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Drag this email to <strong>Primary</strong> and star it.</p>
                      <table width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px 0;">
                        <tr>
                          <td align="center" style="border:1px solid #e7e5e4;border-radius:8px;background-color:#ffffff;padding:12px;">
                            <img src="${siteUrl}/uploads/email_one.gif" alt="Gmail: drag to Primary tab and star the email" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;" />
                          </td>
                        </tr>
                      </table>
                      <p style="margin:0 0 8px 0;font-size:14px;font-weight:700;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Outlook</p>
                      <p style="margin:0 0 12px 0;font-size:14px;line-height:1.6;color:#57534e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Drag this email from <strong>Other</strong> to <strong>Focused</strong>.</p>
                      <table width="100%" cellpadding="0" cellspacing="0" border="0">
                        <tr>
                          <td align="center" style="border:1px solid #e7e5e4;border-radius:8px;background-color:#ffffff;padding:12px;">
                            <img src="${siteUrl}/uploads/email_two.gif" alt="Outlook: drag from Other to Focused inbox" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0;outline:none;text-decoration:none;" />
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding-bottom:36px;">
                <p style="margin:0 0 14px 0;font-size:15px;line-height:1.7;color:#44403c;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Your first AI briefing arrives soon.</p>
                <p style="margin:0;font-size:15px;font-weight:600;color:#1c1917;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Borna</p>
                <p style="margin:0;font-size:14px;color:#a8a29e;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;">Founder, AI Recap</p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `,
  text: [
    "You've successfully subscribed to AI Recap.",
    "",
    "I'm Borna. AI Recap is a quick daily briefing on what actually matters in AI.",
    "Models. Research. Launches. Major moves. Delivered in about 3 minutes.",
    "",
    "Before your first briefing:",
    "1. Confirm you're human by emailing hello@airecap.news with the subject 'AI Recap'.",
    "2. If this email landed in Promotions, Spam, or Other, move it to your main inbox.",
    "",
    "Your first AI briefing arrives soon.",
    "Borna",
    "Founder, AI Recap",
  ].join("\n"),
  } as const;
}