import { describe, expect, it, vi } from "vitest";

import {
  buildExtractionPrompt,
  createOpenAIExtractor,
  EXTRACTION_EFFORT,
  EXTRACTION_MODEL,
  parseExtractedStories,
  STORY_CATEGORIES,
} from "@/src/pipeline/ingest/extract";

const STORY = {
  category: "Tools",
  headline: "Example Ships a Tool",
  summary: "A summary.",
  story_detail: "More detail.",
  published_at: "2026-11-09",
  url: "https://example.org/tool",
  importance_score: 2,
};

describe("buildExtractionPrompt", () => {
  it("fills in the fallback date and the source text, and asks for no web search", () => {
    const prompt = buildExtractionPrompt({ sourceDate: "2026-11-09", text: "Issue body" });
    expect(prompt).toContain("- Otherwise use: 2026-11-09");
    expect(prompt.endsWith("# Source Text:\nIssue body")).toBe(true);
    expect(prompt).not.toMatch(/web ?search/i);
    expect(prompt).not.toContain("{{");
  });
});

describe("parseExtractedStories", () => {
  it("accepts stories that match the schema", () => {
    expect(parseExtractedStories(JSON.stringify({ stories: [STORY] }))).toEqual([STORY]);
  });

  it("rejects output that does not match the schema", () => {
    expect(() => parseExtractedStories("not json")).toThrow("not valid JSON");
    expect(() => parseExtractedStories(JSON.stringify({ items: [] }))).toThrow("no stories array");
    expect(() => parseExtractedStories(JSON.stringify({ stories: [{ ...STORY, category: "Gossip" }] }))).toThrow(
      "story 1: category",
    );
    expect(() => parseExtractedStories(JSON.stringify({ stories: [{ ...STORY, published_at: "Nov 9" }] }))).toThrow(
      "story 1: published_at",
    );
    expect(() => parseExtractedStories(JSON.stringify({ stories: [STORY, { ...STORY, importance_score: 7 }] }))).toThrow(
      "story 2: importance_score",
    );
  });

  it("lists each category once (n8n's schema listed Launches twice)", () => {
    expect(new Set(STORY_CATEGORIES).size).toBe(STORY_CATEGORIES.length);
  });
});

describe("createOpenAIExtractor", () => {
  function fakeClient(...outputs: Array<string | Error>) {
    const create = vi.fn<(request: unknown) => Promise<{ output_text: string }>>(async () => {
      const next = outputs.shift();
      if (next instanceof Error) throw next;
      return { output_text: next ?? "" };
    });
    return { client: { responses: { create } }, create };
  }

  async function sentRequest() {
    const { client, create } = fakeClient(JSON.stringify({ stories: [STORY] }));
    await createOpenAIExtractor({ client })({ sourceDate: "2026-11-09", text: "Issue body" });
    return create.mock.calls[0][0] as Record<string, unknown> & { text: { format: Record<string, unknown> } };
  }

  it("returns the stories of the answer", async () => {
    const { client } = fakeClient(JSON.stringify({ stories: [STORY] }));
    await expect(createOpenAIExtractor({ client })({ sourceDate: "2026-11-09", text: "Issue body" })).resolves.toEqual([STORY]);
  });

  it("calls gpt-6-luna", async () => {
    expect(EXTRACTION_MODEL).toBe("gpt-6-luna");
    expect((await sentRequest()).model).toBe("gpt-6-luna");
  });

  it("calls at medium effort", async () => {
    expect(EXTRACTION_EFFORT).toBe("medium");
    expect((await sentRequest()).reasoning).toEqual({ effort: "medium" });
  });

  it("asks for the strict news_stories schema", async () => {
    expect((await sentRequest()).text.format).toMatchObject({ type: "json_schema", name: "news_stories", strict: true });
  });

  it("uses no web search", async () => {
    expect((await sentRequest()).tools).toBeUndefined();
  });

  it("stores nothing", async () => {
    expect((await sentRequest()).store).toBe(false);
  });

  it("uses the model and effort it is given (for evals)", async () => {
    const { client, create } = fakeClient(JSON.stringify({ stories: [] }));
    await createOpenAIExtractor({ client, model: "gpt-6-sol", effort: "high" })({ sourceDate: "2026-11-09", text: "x" });
    expect(create.mock.calls[0][0]).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "high" } });
  });

  it("retries once, then reports the failure", async () => {
    const retried = fakeClient("broken", JSON.stringify({ stories: [] }));
    await expect(createOpenAIExtractor({ client: retried.client })({ sourceDate: "2026-11-09", text: "x" })).resolves.toEqual([]);
    expect(retried.create).toHaveBeenCalledTimes(2);

    const failing = fakeClient(new Error("HTTP 500"), "broken");
    await expect(createOpenAIExtractor({ client: failing.client })({ sourceDate: "2026-11-09", text: "x" })).rejects.toThrow(
      "Extraction failed twice: model output is not valid JSON.",
    );
  });
});
