import { normalizeSubscriberEmail } from "@/src/features/subscriber/server";

function getGhlSubscribeWebhookUrl() {
  const webhookUrl = process.env.GHL_SUBSCRIBE_WEBHOOK_URL?.trim();

  if (!webhookUrl) {
    throw new Error("GHL_SUBSCRIBE_WEBHOOK_URL is not configured.");
  }

  return webhookUrl;
}

const DUPLICATE_HINTS = [
  "already exists",
  "duplicate",
  "existing contact",
  "already subscribed",
];

export async function submitSubscriberToGhl(input: {
  firstName?: string | null;
  email: string;
  source: string;
  path: string | null;
}) {
  const response = await fetch(getGhlSubscribeWebhookUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      firstName: input.firstName?.trim() || null,
      email: normalizeSubscriberEmail(input.email),
      source: input.source,
      path: input.path,
      subscribedAt: new Date().toISOString(),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const responseBody = (await response.text().catch(() => "")).toLowerCase();

    if (DUPLICATE_HINTS.some((hint) => responseBody.includes(hint))) {
      return;
    }

    throw new Error("GHL subscribe request failed.");
  }
}
