import OpenAI from "openai";
import { logServerError, logServerInfo } from "@/src/server/observability";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface DeduplicationInput {
  incomingStories: Array<{
    id: number;
    headline: string;
    summary: string;
    story_details: string | null;
  }>;
  referencedStories: Array<{
    id: number;
    headline: string;
    summary: string;
    story_details: string | null;
  }>;
}

export interface DeduplicationResult {
  kept_story_ids: number[];
}

/**
 * Submits a deduplication request to OpenAI's Responses API in background mode as true.
 * Returns the response ID for polling later.
 */
export async function submitDeduplication(
  input: DeduplicationInput,
  date: string
): Promise<string> {
  logServerInfo("openai.response.submit.start", {
    date,
    incomingCount: input.incomingStories.length,
    referencedCount: input.referencedStories.length,
  });

  const userMessage = `You will receive a JSON object with:

* \`incoming_stories\`: an array of incoming story objects that have not been used before.
* \`previously_used_stories\`: an array of story objects that have already been used.

Your task is to decide which incoming stories should be kept, then return only their IDs.

Core rule:
* Remove any incoming story that is meaningfully the same underlying story as something in \`previously_used_stories\`.
* If multiple incoming stories are meaningfully the same underlying story as each other, keep only the strongest one and remove the rest.

Important judgment guidance:
* Two stories can describe the same underlying event even if their headlines, summaries, phrasing, IDs, and URLs are different.
* Focus on the underlying news item being reported: the event, announcement, launch, release, acquisition, update, ruling, funding round, product change, or other concrete development.
* If two stories clearly point to the same underlying development, treat them as duplicates.
* Do not merge stories just because they mention the same company, product, person, or topic area. If they describe different developments, keep them separate.

Your tasks:
1. Compare each incoming story against \`previously_used_stories\`.
   - If an incoming story is semantically the same underlying story as a previously used story, remove it.

2. Compare stories within \`incoming_stories\`.
   - If multiple incoming stories are semantically the same underlying story, keep only one.

3. When choosing which duplicate to keep, keep the one with the more complete, specific, and information-rich \`summary\` or \`story_details\`.

Output exactly one JSON object:
{
  "kept_story_ids": [123, 456, 789]
}

Rules:
* Include only IDs from \`incoming_stories\`
* Do not include IDs from \`previously_used_stories\`
* Do not include duplicates
* Preserve the original ID values exactly as provided

INPUT:
${JSON.stringify({
  incoming_stories: input.incomingStories.map((s) => ({
    id: s.id,
    headline: s.headline,
    summary: s.summary,
  })),
  previously_used_stories: input.referencedStories.map((s) => ({
    id: s.id,
    headline: s.headline,
    summary: s.summary,
  })),
})}`;

  // Submit to Responses API in background mode for async processing
  const response = await (client.responses as any).create({
    model: "gpt-4o-mini",
    instructions:
      "You identify duplicate news stories by comparing the underlying event being reported. Return only valid JSON.",
    input: userMessage,
    background: true,
    store: true,
    text: {
      format: {
        type: "json_schema",
        name: "deduplication_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            kept_story_ids: {
              type: "array",
              items: { type: "integer" },
            },
          },
          required: ["kept_story_ids"],
          additionalProperties: false,
        },
      },
    },
  });

  logServerInfo("openai.response.submit.success", {
    responseId: response.id,
    date,
    status: response.status,
    inputLength: userMessage.length,
  });

  return response.id;
}

/**
 * Checks the status of a submitted response in background mode.
 * Returns the status and the result if complete.
 */
export async function checkDeduplicationStatus(
  responseId: string
): Promise<{
  status: "pending" | "completed" | "failed";
  result?: DeduplicationResult;
  error?: string;
}> {
  const response = await (client.responses as any).retrieve(responseId);

  logServerInfo("openai.response.status.check", {
    responseId,
    status: response.status,
  });

  // Handle in-progress states
  if (response.status === "queued" || response.status === "in_progress") {
    return { status: "pending" };
  }

  // Handle completion
  if (response.status === "completed") {
    try {
      const outputText = response.output_text || "";
      if (!outputText) {
        return { status: "failed", error: "No output_text in response" };
      }

      logServerInfo("openai.response.result.raw", {
        responseId,
        outputLength: outputText.length,
        outputPreview: outputText.slice(0, 200),
      });

      const parsed = JSON.parse(outputText) as DeduplicationResult;
      logServerInfo("openai.response.result.success", {
        responseId,
        keptCount: parsed.kept_story_ids?.length ?? 0,
      });

      return { status: "completed", result: parsed };
    } catch (err) {
      logServerError("openai.response.result.parse_error", err, { responseId });
      return {
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to parse response",
      };
    }
  }

  // Handle failure states
  if (response.status === "failed" || response.status === "cancelled") {
    const errorMsg = response.error || "Response generation failed";
    logServerError("openai.response.status.failed", new Error(errorMsg), { responseId, openaiError: response.error });
    return { status: "failed", error: errorMsg };
  }

  if (response.status === "expired") {
    logServerError("openai.response.status.expired", new Error("Deduplication response expired before completion."), { responseId });
    return { status: "failed", error: "Deduplication response expired before completion." };
  }

  // Any other unknown status — treat as still pending
  return { status: "pending" };
}
