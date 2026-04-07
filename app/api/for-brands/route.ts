import {
  createRequestLogContext,
  jsonWithRequestId,
  logRequestError,
  logRequestStart,
  logRequestSuccess,
  logRequestWarning,
  maskEmail,
} from "@/server/observability";

const DEFAULT_FOR_BRANDS_WEBHOOK_URL =
  "https://services.leadconnectorhq.com/hooks/fDAdpJZcGhmldVYsosCp/webhook-trigger/010cd443-f883-4f43-a3e9-96af35e039de";

function getForBrandsWebhookUrl() {
  return process.env.FOR_BRANDS_WEBHOOK_URL?.trim() || DEFAULT_FOR_BRANDS_WEBHOOK_URL;
}

type LeadPayload = {
  name?: string;
  workEmail?: string;
  website?: string;
  whoYouWantToReach?: string;
  mainGoal?: string;
  extraContext?: string;
};

type FieldErrors = Partial<Record<keyof LeadPayload, string>>;

function isBlank(value: unknown) {
  return typeof value !== "string" || value.trim().length === 0;
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidWebsite(value: string) {
  return /^(https?:\/\/)?([\w-]+\.)+[\w-]{2,}(\/.*)?$/i.test(value);
}

function normalizeWebsite(value: string) {
  const trimmed = value.trim();

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed;
  }

  return `https://${trimmed}`;
}

function splitName(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  const [firstName = "", ...rest] = parts;

  return {
    firstName,
    lastName: rest.join(' '),
  };
}

export async function POST(request: Request) {
  const context = createRequestLogContext("api.for-brands", request);
  let payload: LeadPayload | null = null;

  logRequestStart(context, {
    contentType: request.headers.get("content-type"),
  });

  try {
    payload = (await request.json()) as LeadPayload;
    const fieldErrors: FieldErrors = {};

    if (isBlank(payload.name)) {
      fieldErrors.name = "This field is required.";
    }
    if (isBlank(payload.workEmail)) {
      fieldErrors.workEmail = "This field is required.";
    }
    if (isBlank(payload.website)) {
      fieldErrors.website = "This field is required.";
    }
    if (isBlank(payload.whoYouWantToReach)) {
      fieldErrors.whoYouWantToReach = "This field is required.";
    }
    if (isBlank(payload.mainGoal)) {
      fieldErrors.mainGoal = "This field is required.";
    }

    if (Object.keys(fieldErrors).length > 0) {
      logRequestWarning(context, "For-brands validation failed", {
        fieldErrors,
        email: maskEmail(payload.workEmail),
      });

      return jsonWithRequestId(
        context,
        {
          error: "Please fill in the required fields.",
          fieldErrors,
        },
        { status: 400 },
      );
    }

    const trimmedEmail = payload.workEmail!.trim();
    const trimmedWebsite = payload.website!.trim();
    const trimmedName = payload.name!.trim();
    const { firstName, lastName } = splitName(trimmedName);

    if (!isValidEmail(trimmedEmail)) {
      logRequestWarning(context, "For-brands email validation failed", {
        email: maskEmail(trimmedEmail),
      });

      return jsonWithRequestId(
        context,
        {
          error: "Enter a valid work email.",
          fieldErrors: {
            workEmail: "Enter a valid work email.",
          },
        },
        { status: 400 },
      );
    }

    if (!isValidWebsite(trimmedWebsite)) {
      logRequestWarning(context, "For-brands website validation failed", {
        email: maskEmail(trimmedEmail),
        website: trimmedWebsite,
      });

      return jsonWithRequestId(
        context,
        {
          error: "Enter a valid website.",
          fieldErrors: {
            website: "Enter a valid website, like example.com.",
          },
        },
        { status: 400 },
      );
    }

    const outboundPayload = {
      ...payload,
      name: trimmedName,
      firstName,
      lastName,
      email: trimmedEmail,
      workEmail: trimmedEmail,
      website: normalizeWebsite(trimmedWebsite),
      whoYouWantToReach: payload.whoYouWantToReach!.trim(),
      mainGoal: payload.mainGoal!.trim(),
      extraContext: payload.extraContext?.trim() || "",
      source: "ai-recap-for-brands",
      submittedAt: new Date().toISOString(),
    };

    const response = await fetch(getForBrandsWebhookUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(outboundPayload),
      cache: "no-store",
    });

    if (!response.ok) {
      const responseBody = await response.text().catch(() => "");

      logRequestError(
        context,
        "For-brands webhook request failed",
        new Error(`Webhook responded with status ${response.status}`),
        {
          email: maskEmail(trimmedEmail),
          website: outboundPayload.website,
          webhookStatus: response.status,
          webhookStatusText: response.statusText,
          webhookResponseBody: responseBody,
        },
      );

      return jsonWithRequestId(
        context,
        { error: "Could not send your message right now." },
        { status: 502 },
      );
    }

    logRequestSuccess(context, {
      email: maskEmail(trimmedEmail),
      website: outboundPayload.website,
    });

    return jsonWithRequestId(context, { success: true });
  } catch (error) {
    logRequestError(context, "Unhandled for-brands route failure", error, {
      email: maskEmail(payload?.workEmail),
      website: payload?.website?.trim() || null,
    });

    return jsonWithRequestId(
      context,
      { error: "Could not send your message right now." },
      { status: 500 },
    );
  }
}
