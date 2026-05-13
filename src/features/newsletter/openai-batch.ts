import OpenAI, { toFile } from "openai";
import { logServerError, logServerInfo } from "@/src/server/observability";

const client = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export interface DeduplicationBatchInput {
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

export interface DeduplicationBatchResult {
  kept_story_ids: number[];
}

/**
 * Submits a deduplication job to OpenAI's Batch API.
 * Returns the batch job ID for polling later.
 */
export async function submitDeduplicationBatch(
  input: DeduplicationBatchInput,
  date: string
): Promise<string> {
  logServerInfo("openai.batch.submit.start", {
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

  // Build JSONL request
  const jsonlRequest = JSON.stringify({
    custom_id: `dedup-${date}`,
    method: "POST",
    url: "/v1/chat/completions",
    body: {
      model: "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content:
            "You identify duplicate news stories by comparing the underlying event being reported. Return only valid JSON.",
        },
        {
          role: "user",
          content: userMessage,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
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
    },
  });

  // Create a Buffer from the JSONL content
  const fileContent = jsonlRequest + "\n";
  const buffer = Buffer.from(fileContent);

  const fileSizeBytes = buffer.byteLength;
  const fileSizeKb = (fileSizeBytes / 1024).toFixed(1);
  const inputChars = userMessage.length;

  logServerInfo("openai.batch.file.size", {
    date,
    bytes: fileSizeBytes,
    kb: fileSizeKb,
    inputChars,
    incomingCount: input.incomingStories.length,
    referencedCount: input.referencedStories.length,
  });

  // Guard: OpenAI's Batch API file size limit is 100 MB
  const MAX_FILE_SIZE_BYTES = 100 * 1024 * 1024;
  if (fileSizeBytes > MAX_FILE_SIZE_BYTES) {
    throw new Error(
      `Batch file too large: ${fileSizeKb} KB exceeds the 100 MB OpenAI limit. ` +
      `Reduce the number of stories or truncate summaries.`
    );
  }

  // Upload the file using toFile() so the SDK encodes it as a proper multipart upload
  const file = await client.files.create({
    file: await toFile(buffer, `dedup-batch-${date}.jsonl`, { type: "application/jsonl" }),
    purpose: "batch",
  });

  logServerInfo("openai.batch.file.uploaded", {
    fileId: file.id,
    date,
  });

  // Create the batch
  const batch = await client.batches.create({
    input_file_id: file.id,
    endpoint: "/v1/chat/completions",
    completion_window: "24h",
  });

  logServerInfo("openai.batch.submit.success", {
    batchId: batch.id,
    date,
    fileId: file.id,
  });

  return batch.id;
}

/**
 * Checks the status of a submitted batch job.
 * Returns the status and the result if complete.
 */
export async function checkBatchStatus(
  batchId: string
): Promise<{
  status: "queued" | "in_progress" | "completed" | "failed" | "expired" | "processing";
  result?: DeduplicationBatchResult;
  error?: string;
}> {
  const batch = await (client.batches.retrieve as any)(batchId);

  logServerInfo("openai.batch.status.check", {
    batchId,
    status: batch.status,
    requestCounts: batch.request_counts,
  });

  // Map OpenAI batch status to our status enum
  let mappedStatus: "queued" | "in_progress" | "completed" | "failed" | "expired" | "processing" =
    "processing";
  
  if (batch.status === "validating" || batch.status === "queued") {
    mappedStatus = "queued";
  } else if (batch.status === "in_progress" || batch.status === "finalizing") {
    mappedStatus = "in_progress";
  } else if (batch.status === "completed") {
    mappedStatus = "completed";
  } else if (batch.status === "failed" || batch.status === "cancelling" || batch.status === "cancelled") {
    mappedStatus = "failed";
  }

  if (mappedStatus === "completed" && batch.output_file_id) {
    try {
      // Download results file
      const fileResponse = await client.files.content(batch.output_file_id);
      const content = await fileResponse.text();

      logServerInfo("openai.batch.result.raw", {
        batchId,
        contentLength: content.length,
        contentPreview: content.slice(0, 500),
      });

      // Parse JSONL response (one line per request)
      const lines = content.trim().split("\n").filter(Boolean);

      logServerInfo("openai.batch.result.lines", {
        batchId,
        lineCount: lines.length,
      });

      if (lines.length === 0) {
        return { status: "failed", error: "Output file was empty" };
      }

      const resultLine = JSON.parse(lines[0]);

      logServerInfo("openai.batch.result.parsed_line", {
        batchId,
        customId: resultLine.custom_id,
        resultType: resultLine.response?.status_code,
        hasBody: Boolean(resultLine.response?.body),
      });

      const responseBody = resultLine.response?.body;
      if (!responseBody) {
        return { status: "failed", error: "No response body in batch result" };
      }

      const messageContent = responseBody.choices?.[0]?.message?.content;
      if (!messageContent) {
        logServerInfo("openai.batch.result.no_content", {
          batchId,
          responseBody: JSON.stringify(responseBody).slice(0, 300),
        });
        return { status: "failed", error: "No message content in batch result" };
      }

      const parsed = JSON.parse(messageContent) as DeduplicationBatchResult;
      logServerInfo("openai.batch.result.success", {
        batchId,
        keptCount: parsed.kept_story_ids?.length ?? 0,
      });

      return { status: "completed", result: parsed };
    } catch (err) {
      logServerError("openai.batch.result.parse_error", err, { batchId });
      return {
        status: "failed",
        error: err instanceof Error ? err.message : "Failed to retrieve results",
      };
    }
  }

  if (mappedStatus === "failed") {
    return {
      status: "failed",
      error: `Batch ${batch.status}`,
    };
  }

  return {
    status: mappedStatus,
  };
}
