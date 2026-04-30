import { describe, expect, it } from "vitest";

import {
  buildDeduplicationResponseFormat,
  buildOpenRouterDeduplicationRequest,
  buildOpenRouterDeduplicationRequestOptions,
  cleanText,
  OPENROUTER_RESPONSE_CACHE_TTL_SECONDS,
  parseDeduplicationKeptStoryIds,
  runWithOpenRouterDeduplicationTimeout,
} from "@/src/features/newsletter/curation.service";

describe("newsletter curation OpenRouter request", () => {
  it("uses DeepSeek V4 Flash first with Gemini Flash fallback, price routing, and no token cap", () => {
    const request = buildOpenRouterDeduplicationRequest([
      { role: "system", content: "Return JSON." },
      { role: "user", content: "Deduplicate these stories." },
    ]);

    expect(request.chatRequest).toMatchObject({
      models: ["deepseek/deepseek-v4-flash", "google/gemini-3-flash-preview"],
      provider: {
        sort: "price",
        dataCollection: "deny",
        requireParameters: true,
        allowFallbacks: true,
      },
      responseFormat: {
        type: "json_schema",
        jsonSchema: {
          name: "newsletter_deduplication_result",
          strict: true,
          schema: {
            type: "object",
            required: ["kept_story_ids"],
            additionalProperties: false,
          },
        },
      },
    });
    expect(request.chatRequest).not.toHaveProperty("model");
    expect(request.chatRequest).not.toHaveProperty("maxTokens");
    expect(request.chatRequest).not.toHaveProperty("maxCompletionTokens");
  });

  it("defines a strict structured-output schema for kept story ids", () => {
    expect(buildDeduplicationResponseFormat()).toEqual({
      type: "json_schema",
      jsonSchema: {
        name: "newsletter_deduplication_result",
        strict: true,
        schema: {
          type: "object",
          properties: {
            kept_story_ids: {
              type: "array",
              description:
                "IDs from incoming_stories that should remain after removing semantic duplicates.",
              items: {
                type: "integer",
              },
            },
          },
          required: ["kept_story_ids"],
          additionalProperties: false,
        },
      },
    });
  });

  it("uses no SDK retries or SDK timeout for interactive approval requests", () => {
    const options = buildOpenRouterDeduplicationRequestOptions();

    expect(options).toMatchObject({
      retries: { strategy: "none" },
    });
    expect(options).not.toHaveProperty("timeoutMs");
    expect(options).not.toHaveProperty("signal");
  });

  it("enables OpenRouter response caching for repeated server-side deduplication requests", () => {
    const options = buildOpenRouterDeduplicationRequestOptions();

    expect(OPENROUTER_RESPONSE_CACHE_TTL_SECONDS).toBe(86_400);
    expect(options?.headers).toMatchObject({
      "X-OpenRouter-Cache": "true",
      "X-OpenRouter-Cache-TTL": "86400",
    });
  });

  it("enforces a wall-clock timeout around the full OpenRouter operation", async () => {
    const never = new Promise<string>(() => undefined);

    await expect(
      runWithOpenRouterDeduplicationTimeout(never, 1)
    ).rejects.toThrow("OpenRouter deduplication timed out after 1ms");
  });

  it("parses structured deduplication ids defensively", () => {
    expect(
      parseDeduplicationKeptStoryIds(
        JSON.stringify({ kept_story_ids: [10, "11", 999, 10] }),
        new Set([10, 11, 12])
      )
    ).toEqual([10, 11]);

    expect(
      parseDeduplicationKeptStoryIds(
        JSON.stringify({ kept_story_id: [10] }),
        new Set([10])
      )
    ).toBeNull();

    expect(
      parseDeduplicationKeptStoryIds("not json", new Set([10]))
    ).toBeNull();
  });

  it("cleans markdown and URLs without injecting replacement placeholders", () => {
    expect(
      cleanText(
        "- **[OpenAI launches model](https://example.com)** read more at https://example.com"
      )
    ).toBe("OpenAI launches model");
  });
});
