import { normalizeSubscriberEmail } from "@/features/subscriber/identity";
import { logServerError, logServerInfo, logServerWarn, maskEmail } from "@/server/observability";

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
  const normalizedEmail = normalizeSubscriberEmail(input.email);

  logServerInfo("subscriber.ghl.subscribe.start", {
    email: maskEmail(normalizedEmail),
    source: input.source,
    path: input.path,
  });

  const response = await fetch(getGhlSubscribeWebhookUrl(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      firstName: input.firstName?.trim() || null,
      email: normalizedEmail,
      source: input.source,
      path: input.path,
      subscribedAt: new Date().toISOString(),
    }),
    cache: "no-store",
  });

  if (!response.ok) {
    const rawResponseBody = await response.text().catch(() => "");
    const responseBody = rawResponseBody.toLowerCase();

    if (DUPLICATE_HINTS.some((hint) => responseBody.includes(hint))) {
      logServerWarn("subscriber.ghl.subscribe.duplicate", {
        email: maskEmail(normalizedEmail),
        source: input.source,
        path: input.path,
        status: response.status,
        statusText: response.statusText,
        body: rawResponseBody,
      });
      return;
    }

    logServerError("subscriber.ghl.subscribe.failure", new Error(`GHL responded with ${response.status}`), {
      email: maskEmail(normalizedEmail),
      source: input.source,
      path: input.path,
      status: response.status,
      statusText: response.statusText,
      body: rawResponseBody,
    });

    throw new Error("GHL subscribe request failed.");
  }

  logServerInfo("subscriber.ghl.subscribe.success", {
    email: maskEmail(normalizedEmail),
    source: input.source,
    path: input.path,
    status: response.status,
  });
}
