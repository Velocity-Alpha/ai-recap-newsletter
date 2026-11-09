import { fetchText } from "@/src/pipeline/draft/articles/http";
import { markdownToText } from "@/src/pipeline/draft/articles/text";
import { MethodError, PAGE_MAX_BYTES, READER_USER_AGENT, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Method 3 (#115): Jina Reader (https://jina.ai/reader/) loads the page in its own browser and returns Markdown.
 * It works with no key (20 requests a minute). JINA_API_KEY, when set, is sent as a Bearer token; a free key
 * probably lifts Jina's "anonymous access to domain blocked" answers.
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

  const answer = await fetchText(`${JINA_READER}${url}`, { ...context, headers, maxBytes: PAGE_MAX_BYTES });
  let body: JinaAnswer;
  try {
    body = JSON.parse(answer.body) as JinaAnswer;
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
    text: markdownToText(body.data.content ?? ""),
    httpStatus: typeof body.data.httpStatus === "number" ? body.data.httpStatus : 200,
    finalUrl: body.data.url ?? url,
  };
}
