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

interface BeehiivSubscription {
  id: string;
  email: string;
  status: string;
  created_at: string;
  updated_at: string;
}

/**
 * Checks Beehiiv for a subscriber by email.
 * Returns the subscription status (e.g., "active", "unsubscribed") or null if not found.
 */
export async function getBeehiivSubscriberStatus(
  email: string
): Promise<{ status: string; id: string } | null> {
  const apiKey = getBeehiivApiKey();
  const publicationId = getBeehiivPublicationId();

  logServerInfo("subscriber.beehiiv.status.check", {
    email: maskEmail(email),
  });

  try {
    const response = await fetch(
      `https://api.beehiiv.com/v2/publications/${publicationId}/subscriptions?email=${encodeURIComponent(email)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        cache: "no-store",
      },
    );

    if (!response.ok) {
      logServerWarn("subscriber.beehiiv.status.fetch_failed", {
        email: maskEmail(email),
        status: response.status,
      });
      return null;
    }

    const data = (await response.json()) as { data?: BeehiivSubscription[] };

    if (!data.data || data.data.length === 0) {
      logServerInfo("subscriber.beehiiv.status.not_found", {
        email: maskEmail(email),
      });
      return null;
    }

    const subscription = data.data[0];

    logServerInfo("subscriber.beehiiv.status.found", {
      email: maskEmail(email),
      status: subscription.status,
    });

    if (subscription.status === "invalid" || subscription.status === "inactive") {
      logServerWarn("subscriber.beehiiv.status.invalid", {
        email: maskEmail(email),
      });
      return null;
    }

    return {
      status: subscription.status,
      id: subscription.id,
    };
  } catch (error) {
    if (error instanceof Error && /not configured/i.test(error.message)) {
      throw error;
    }

    logServerError("subscriber.beehiiv.status.error", error, {
      email: maskEmail(email),
    });

    return null;
  }
}
