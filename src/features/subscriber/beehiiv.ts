import { logServerError, logServerInfo, logServerWarn, maskEmail } from "@/src/server/observability";

function getBeehiivApiKey() {
  const apiKey = process.env.BEEHIIV_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("BEEHIIV_API_KEY is not configured.");
  }

  return apiKey;
}

function getBeehiivPublicationId() {
  const publicationId = process.env.BEEHIIV_PUBLICATION_ID?.trim();

  if (!publicationId) {
    throw new Error("BEEHIIV_PUBLICATION_ID is not configured.");
  }

  return publicationId;
}

const DUPLICATE_HINTS = [
  "already exists",
  "duplicate",
  "existing",
  "already subscribed",
];

interface BeehiivSubscribeInput {
  firstName?: string | null;
  email: string;
  source: string;
  path: string | null;
}

export async function submitSubscriberToBeehiiv(input: BeehiivSubscribeInput) {
  const apiKey = getBeehiivApiKey();
  const publicationId = getBeehiivPublicationId();

  logServerInfo("subscriber.beehiiv.subscribe.start", {
    email: maskEmail(input.email),
    source: input.source,
    path: input.path,
  });

  try {
    console.log("[beehiiv] submitting subscription", { email: maskEmail(input.email), source: input.source, path: input.path, firstName: input.firstName ?? null });
    const response = await fetch(
      `https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: input.email,
          reactivate_existing: true,
          send_welcome_email: false,
          custom_fields: input.firstName
            ? [
                {
                  name: "First Name",
                  value: input.firstName.trim(),
                },
              ]
            : [],
          utm_source: input.source,
          utm_campaign: input.path || undefined,
        }),
        cache: "no-store",
      },
    );

    if (!response.ok) {
      const rawResponseBody = await response.text().catch(() => "");
      const responseBody = rawResponseBody.toLowerCase();

      if (DUPLICATE_HINTS.some((hint) => responseBody.includes(hint))) {
        logServerWarn("subscriber.beehiiv.subscribe.duplicate", {
          email: maskEmail(input.email),
          source: input.source,
          path: input.path,
          status: response.status,
          statusText: response.statusText,
          body: rawResponseBody,
        });
        return;
      }

      logServerError(
        "subscriber.beehiiv.subscribe.failure",
        new Error(`Beehiiv responded with ${response.status}`),
        {
          email: maskEmail(input.email),
          source: input.source,
          path: input.path,
          status: response.status,
          statusText: response.statusText,
          body: rawResponseBody,
        },
      );

      throw new Error("Beehiiv subscribe request failed.");
    }

    logServerInfo("subscriber.beehiiv.subscribe.success", {
      email: maskEmail(input.email),
      source: input.source,
      path: input.path,
      status: response.status,
    });
  } catch (error) {
    if (error instanceof Error && /not configured/i.test(error.message)) {
      throw error;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Beehiiv subscribe request failed.");
  }
}
