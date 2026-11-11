import { fetchBody } from "@/src/pipeline/draft/articles/http";
import { MethodError, PAGE_MAX_BYTES, READER_USER_AGENT, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * The last method (#115, #170): Jina Reader (https://jina.ai/reader/) loads the page in its own browser and returns
 * Markdown. The call is anonymous (free, 20 requests a minute per server address): JINA_API_KEY is not set in
 * production. A key, if one is ever set, is sent as a Bearer token. A refusal (402, 429, or any other error) leaves
 * the article unread with Jina's reason; 403 and 451 count as blocked, the rest as failed.
 */

const JINA_READER = "https://r.jina.ai/";
const MAX_MESSAGE_CHARS = 300;

interface JinaAnswer {
  code?: number;
  message?: string;
  readableMessage?: string;
  data?: { url?: string; content?: string; httpStatus?: number } | null;
}

export async function readWithJina(url: string, context: MethodContext): Promise<MethodText> {
  const headers: Record<string, string> = { Accept: "application/json", "X-Retain-Images": "none", "User-Agent": READER_USER_AGENT };
  if (context.jinaApiKey) headers.Authorization = `Bearer ${context.jinaApiKey}`;

  const answer = await fetchBody(`${JINA_READER}${url}`, { ...context, headers, maxBytes: PAGE_MAX_BYTES });
  let body: JinaAnswer;
  try {
    body = JSON.parse(answer.text) as JinaAnswer;
  } catch {
    throw new MethodError("failed", answer.status >= 400 ? `Jina returned HTTP ${answer.status}.` : "Jina returned something other than JSON.");
  }

  if (answer.status >= 400 || !body.data) {
    const reason = (body.readableMessage ?? body.message ?? "no reason given").slice(0, MAX_MESSAGE_CHARS);
    // 403 and 451 are Jina refusing the domain, which is a block, not a broken page.
    const status = answer.status === 403 || answer.status === 451 ? "blocked" : "failed";
    throw new MethodError(status, `Jina returned HTTP ${answer.status}: ${reason}`);
  }

  return {
    text: await context.parse({ kind: "markdown", text: body.data.content ?? "" }, context.signal),
    httpStatus: typeof body.data.httpStatus === "number" ? body.data.httpStatus : 200,
    finalUrl: body.data.url ?? url,
  };
}
