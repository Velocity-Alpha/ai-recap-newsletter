import { createSideEffects, type SideEffectRecord } from "@/src/pipeline/side-effects";

/**
 * Each draft gets its own new GHL email template (ADR 0002). Same two calls as n8n's `2. Create Issue Draft`
 * (docs/n8n-backend/20-drafting-and-images.md §1.8): create the template, then set its HTML.
 *
 * It never edits or deletes an existing template: the input has no template id, and the second call only
 * targets the id the first call returned.
 */

export const GHL_API_BASE = "https://services.leadconnectorhq.com";
export const GHL_API_VERSION = "2021-07-28";

const CREATE_PATH = "/emails/builder";
const SET_HTML_PATH = "/emails/builder/data";
const TIMEOUT_MS = 15_000;

const SETTING = {
  token: "GHL_PRIVATE_INTEGRATION_TOKEN",
  locationId: "GHL_LOCATION_ID",
  userId: "GHL_USER_ID",
} as const;

export interface DraftTemplateInput {
  /** The issue date, `YYYY-MM-DD`. */
  issueDate: string;
  /** The draft's version for that date: 1, 2, ... */
  version: number;
  subject: string;
  html: string;
}

export interface DraftTemplateResult {
  templateId: string;
  /** GHL's preview link, when it returns one. */
  previewUrl?: string;
  /** `recorded` outside production: nothing reached GHL and the id is fake. */
  mode: "sent" | "recorded";
}

export interface DraftTemplateDeps {
  /** `APP_ENV` and the `GHL_*` settings. */
  env: Record<string, string | undefined>;
  fetch?: typeof fetch;
  /** Where non-production calls are recorded (see side-effects). */
  record?: (entry: SideEffectRecord) => void | Promise<void>;
}

export type GhlStep = "createTemplate" | "setTemplateHtml";

const STEP_LABEL: Record<GhlStep, string> = {
  createTemplate: `create template (POST ${CREATE_PATH})`,
  setTemplateHtml: `set template HTML (POST ${SET_HTML_PATH})`,
};

export class GhlTemplateError extends Error {
  constructor(
    message: string,
    readonly step: GhlStep,
    readonly status?: number,
    /** Set when the template was created but a later step failed. */
    readonly templateId?: string,
  ) {
    super(message);
    this.name = "GhlTemplateError";
  }
}

/** `<YYYY-MM-DD> v<version>: <subject>`, the name the owner sees in GHL. */
export function draftTemplateName(input: Pick<DraftTemplateInput, "issueDate" | "version" | "subject">): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) {
    throw new Error(`Issue date "${input.issueDate}" must be YYYY-MM-DD.`);
  }
  if (!Number.isInteger(input.version) || input.version < 1) {
    throw new Error(`Draft version ${input.version} must be a whole number from 1.`);
  }
  const subject = input.subject.replace(/\s+/g, " ").trim();
  if (!subject) throw new Error("The draft subject is empty.");
  return `${input.issueDate} v${input.version}: ${subject}`;
}

interface GhlSettings {
  token: string | null;
  locationId: string | null;
  userId: string | null;
}

function readSettings(env: Record<string, string | undefined>, required: boolean): GhlSettings {
  const read = (name: string) => env[name]?.trim() || null;
  const settings = { token: read(SETTING.token), locationId: read(SETTING.locationId), userId: read(SETTING.userId) };
  if (required) {
    const missing = (Object.keys(SETTING) as (keyof GhlSettings)[]).filter((key) => !settings[key]).map((key) => SETTING[key]);
    if (missing.length > 0) throw new Error(`Missing setting${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}.`);
  }
  return settings;
}

/** Removes the token from text that came back from GHL or the network, in case it is echoed. */
function scrub(text: string, token: string): string {
  return token ? text.split(token).join("[redacted]") : text;
}

/** GHL's error message, cut short. */
async function reason(response: Response, token: string): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { message?: unknown };
  const message = Array.isArray(body.message) ? body.message.join(" ") : body.message;
  if (typeof message !== "string" || !message.trim()) return "";
  return `: ${scrub(message, token).slice(0, 200)}`;
}

async function post(
  step: GhlStep,
  path: string,
  body: Record<string, unknown>,
  context: { token: string; fetch: typeof fetch; templateId?: string },
): Promise<Record<string, unknown>> {
  const label = STEP_LABEL[step];
  const created = context.templateId ? ` Template ${context.templateId} was created.` : "";
  let response: Response;
  try {
    response = await context.fetch(`${GHL_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${context.token}`,
        "Content-Type": "application/json",
        Version: GHL_API_VERSION,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    const detail = error instanceof Error ? scrub(error.message, context.token) : "unknown error";
    throw new GhlTemplateError(`GHL ${label} failed: ${detail}.${created}`, step, undefined, context.templateId);
  }
  if (!response.ok) {
    const why = await reason(response, context.token);
    throw new GhlTemplateError(
      `GHL ${label} failed with HTTP ${response.status}${why}.${created}`,
      step,
      response.status,
      context.templateId,
    );
  }
  return (await response.json().catch(() => ({}))) as Record<string, unknown>;
}

/**
 * Creates a new GHL template for one draft and sets its HTML. Outside production both calls are recorded,
 * nothing is sent, and the template id is a stand-in.
 */
export async function createDraftTemplate(input: DraftTemplateInput, deps: DraftTemplateDeps): Promise<DraftTemplateResult> {
  const name = draftTemplateName(input);
  const effects = createSideEffects({ appEnv: deps.env.APP_ENV, record: deps.record });
  const settings = readSettings(deps.env, effects.live);
  const fetcher = deps.fetch ?? fetch;
  // Only read inside `send`, which runs only in production, where readSettings has checked it.
  const token = settings.token ?? "";

  const createBody = { locationId: settings.locationId, title: name, type: "html", builderVersion: "2", html: input.html };
  const created = await effects.run({
    target: "ghl",
    action: "createTemplate",
    payload: { method: "POST", url: `${GHL_API_BASE}${CREATE_PATH}`, body: createBody },
    send: async () => {
      const response = await post("createTemplate", CREATE_PATH, createBody, { token, fetch: fetcher });
      if (typeof response.id !== "string" || !response.id) {
        throw new GhlTemplateError(`GHL ${STEP_LABEL.createTemplate} returned no template id.`, "createTemplate");
      }
      return response.id;
    },
    dryRun: () => `dry-run-${input.issueDate}-v${input.version}`,
  });
  const templateId = created.value;

  const setHtmlBody = { locationId: settings.locationId, templateId, updatedBy: settings.userId, editorType: "html", html: input.html };
  const filled = await effects.run({
    target: "ghl",
    action: "setTemplateHtml",
    payload: { method: "POST", url: `${GHL_API_BASE}${SET_HTML_PATH}`, body: setHtmlBody },
    send: async () => {
      const response = await post("setTemplateHtml", SET_HTML_PATH, setHtmlBody, { token, fetch: fetcher, templateId });
      return typeof response.previewUrl === "string" && response.previewUrl ? response.previewUrl : undefined;
    },
    dryRun: () => undefined,
  });

  return {
    templateId,
    ...(filled.value ? { previewUrl: filled.value } : {}),
    mode: created.mode,
  };
}
