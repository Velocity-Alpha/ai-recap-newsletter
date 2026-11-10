import { stagedEmailName } from "@/src/pipeline/distribution/staged-version";
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
  /** Stops a running call to GHL, in addition to each call's own 15 s limit. */
  signal?: AbortSignal;
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
  context: { token: string; fetch: typeof fetch; templateId?: string; signal?: AbortSignal },
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
      signal: context.signal ? AbortSignal.any([AbortSignal.timeout(TIMEOUT_MS), context.signal]) : AbortSignal.timeout(TIMEOUT_MS),
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

/** The stand-in template id outside production: the name's `<date> v<version>` part, e.g. `dry-run-2026-11-09-v2`. */
function dryRunTemplateId(name: string): string {
  return `dry-run-${name.split(":")[0].trim().replace(/\s+/g, "-")}`;
}

/** A draft's own template, named `<YYYY-MM-DD> v<version>: <subject>` (`stagedEmailName`). */
export async function createDraftTemplate(input: DraftTemplateInput, deps: DraftTemplateDeps): Promise<DraftTemplateResult> {
  const name = stagedEmailName({ issueDate: input.issueDate, version: input.version, title: input.subject });
  return createEmailTemplate({ name, html: input.html }, deps);
}

/**
 * Creates a new GHL template with this name and sets its HTML. Outside production both calls are recorded,
 * nothing is sent, and the template id is a stand-in.
 */
export async function createEmailTemplate(input: { name: string; html: string }, deps: DraftTemplateDeps): Promise<DraftTemplateResult> {
  const { name } = input;
  const effects = createSideEffects({ appEnv: deps.env.APP_ENV, record: deps.record });
  const settings = readSettings(deps.env, effects.live);
  const fetcher = deps.fetch ?? fetch;
  // Only read inside `send`, which runs only in production, where readSettings has checked it.
  const token = settings.token ?? "";

  const createBody = { locationId: settings.locationId, title: name, type: "html", builderVersion: "2", html: input.html };
  const created = await effects.run({
    target: "distribution",
    action: "createTemplate",
    payload: { method: "POST", url: `${GHL_API_BASE}${CREATE_PATH}`, body: createBody },
    send: async () => {
      const response = await post("createTemplate", CREATE_PATH, createBody, { token, fetch: fetcher, signal: deps.signal });
      if (typeof response.id !== "string" || !response.id) {
        throw new GhlTemplateError(`GHL ${STEP_LABEL.createTemplate} returned no template id.`, "createTemplate");
      }
      return response.id;
    },
    dryRun: () => dryRunTemplateId(name),
  });
  const templateId = created.value;

  const setHtmlBody = { locationId: settings.locationId, templateId, updatedBy: settings.userId, editorType: "html", html: input.html };
  const filled = await effects.run({
    target: "distribution",
    action: "setTemplateHtml",
    payload: { method: "POST", url: `${GHL_API_BASE}${SET_HTML_PATH}`, body: setHtmlBody },
    send: async () => {
      const response = await post("setTemplateHtml", SET_HTML_PATH, setHtmlBody, { token, fetch: fetcher, templateId, signal: deps.signal });
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
