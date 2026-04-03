function getResendApiKey() {
  const apiKey = process.env.RESEND_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("RESEND_API_KEY is not configured.");
  }

  return apiKey;
}

function getResendFromEmail() {
  const fromEmail = process.env.RESEND_FROM_EMAIL?.trim();

  if (!fromEmail) {
    throw new Error("RESEND_FROM_EMAIL is not configured.");
  }

  return fromEmail;
}

function getResendFromName() {
  return process.env.RESEND_FROM_NAME?.trim() || "AI Recap";
}

function getSiteUrl() {
  return (
    process.env.NEXT_PUBLIC_SITE_URL?.trim() ||
    process.env.URL?.trim() ||
    "https://airecap.news"
  ).replace(/\/+$/, "");
}

export async function sendSubscriberOtpEmail(input: { email: string; code: string }) {
  const logoUrl = `${getSiteUrl()}/logo/logo-padded.png`;
  const from = `${getResendFromName()} <${getResendFromEmail()}>`;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${getResendApiKey()}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.email],
      subject: "Your AI Recap sign-in code",
      html: `
        <div style="font-family: 'Source Sans 3', Arial, sans-serif; background:#f7f6f3; padding:32px; color:#2c3e4a;">
          <div style="max-width:640px; margin:0 auto; background:#ffffff; border:1px solid #e8edf0; border-radius:24px; padding:48px 40px;">
            <div style="margin:0 auto 32px; text-align:center;">
              <img src="${logoUrl}" alt="AI Recap" width="82" height="82" style="display:inline-block; width:82px; height:82px;" />
            </div>
            <p style="font-size:18px; line-height:1.6; margin:0 0 28px;">
              Enter the one-time code below on the website to complete your login to AI Recap. This code will expire in 10 minutes.
            </p>
            <div style="background:#f7f6f3; border-radius:20px; padding:28px 24px; text-align:center; margin-bottom:32px;">
              <span style="font-size:48px; line-height:1; font-weight:700; letter-spacing:0.18em; color:#111;">${input.code}</span>
            </div>
            <p style="font-size:15px; line-height:1.6; margin:0; color:#5a6b78;">
              If you did not request this code, you can safely ignore this email.
            </p>
          </div>
        </div>
      `,
      text: `Your AI Recap sign-in code is ${input.code}. It expires in 10 minutes.`,
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error("Could not send OTP email.");
  }
}
