import { DraftRequestError, jsonPost } from "@/src/features/newsletter/draft-links";

/**
 * The draft view's calls for the title change and "Stage for sending" (#149). Safe for client components. Each
 * throws a `DraftRequestError`: a plain message the page can show as is, and the HTTP status.
 */

const OFFLINE = "Could not reach the server. Try again.";

type Fetch = typeof fetch;
type Body = Record<string, unknown>;

async function send(fetcher: Fetch, url: string, init: RequestInit): Promise<{ response: Response; body: Body }> {
  let response: Response;
  try {
    response = await fetcher(url, init);
  } catch {
    throw new DraftRequestError(OFFLINE, null);
  }
  return { response, body: ((await response.json().catch(() => ({}))) ?? {}) as Body };
}

function reason(body: Body, fallback: string): string {
  return typeof body.error === "string" && body.error ? body.error : fallback;
}

/** Saves the new title. Returns the title as the server stored it (one line, trimmed). */
export async function requestTitleChange(draftId: number, title: string, fetcher: Fetch = fetch): Promise<string> {
  const { response, body } = await send(fetcher, `/api/approval/drafts/${draftId}`, { ...jsonPost({ title }), method: "PATCH" });
  if (!response.ok || typeof body.title !== "string") throw new DraftRequestError(reason(body, "Could not change the title."), response.status);
  return body.title;
}

/** A staged version, as the stage route returns it. */
export interface StagedReply {
  version: number;
  /** The distribution service's name for the owner. */
  serviceName: string;
  serviceUrl: string | null;
  /** `recorded` outside production: nothing reached the service. */
  mode: "sent" | "recorded";
  stagedAt: string | null;
}

export type StageReply =
  | { kind: "staged"; staged: StagedReply }
  /** The draft has not changed since this staged version. The owner must confirm a repeat. */
  | { kind: "already_staged"; version: number };

/**
 * "Stage for sending". `confirmRepeat` stages a draft again that has not changed since the newest staged
 * version. Any other refusal or failure throws the server's plain message.
 */
export async function requestStage(draftId: number, confirmRepeat: boolean, fetcher: Fetch = fetch): Promise<StageReply> {
  const { response, body } = await send(fetcher, `/api/approval/drafts/${draftId}/stage`, jsonPost({ confirmRepeat }));
  if (response.status === 409 && body.code === "already_staged" && typeof body.version === "number") {
    return { kind: "already_staged", version: body.version };
  }
  const staged = body.staged as Partial<StagedReply> | undefined;
  if (!response.ok || !staged || typeof staged.version !== "number" || typeof staged.serviceName !== "string") {
    throw new DraftRequestError(reason(body, "Could not stage the draft."), response.status);
  }
  return {
    kind: "staged",
    staged: {
      version: staged.version,
      serviceName: staged.serviceName,
      serviceUrl: typeof staged.serviceUrl === "string" ? staged.serviceUrl : null,
      mode: staged.mode === "recorded" ? "recorded" : "sent",
      stagedAt: typeof staged.stagedAt === "string" ? staged.stagedAt : null,
    },
  };
}
