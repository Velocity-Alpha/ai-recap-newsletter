import { describe, expect, it, vi } from "vitest";

import { createJudge, judgeCacheKey } from "@/evals/lib/judge";
import type { RecordingClient } from "@/evals/lib/usage";

const REQUEST = { name: "grade", instructions: "Grade it.", input: "the text", schema: { type: "object" } };

function fakeClient(...answers: Array<string | Error>) {
  const create = vi.fn(async () => {
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { output_text: next };
  });
  return { client: { responses: { create, retrieve: vi.fn() } } as unknown as RecordingClient, create };
}

async function sentBody(effort: "high" | undefined): Promise<Record<string, unknown>> {
  const { client, create } = fakeClient('{"ok":true}');
  await createJudge({ model: "gpt-6-sol", effort, client })(REQUEST);
  return (create.mock.calls[0] as unknown[])[0] as Record<string, unknown>;
}

describe("createJudge", () => {
  it("returns the parsed JSON answer", async () => {
    const { client } = fakeClient('{"ok":true}');
    await expect(createJudge({ model: "gpt-6-sol", effort: "high", client })(REQUEST)).resolves.toEqual({ ok: true });
  });

  it("sends the judge's model and effort", async () => {
    expect(await sentBody("high")).toMatchObject({ model: "gpt-6-sol", reasoning: { effort: "high" } });
  });

  it("sends no reasoning field when the judge's effort is the API default", async () => {
    expect(await sentBody(undefined)).not.toHaveProperty("reasoning");
  });

  it("sends the rubric as the instructions and the text as the input", async () => {
    expect(await sentBody("high")).toMatchObject({ instructions: "Grade it.", input: "the text" });
  });

  it("asks for strict JSON", async () => {
    expect(await sentBody("high")).toMatchObject({ text: { format: { type: "json_schema", name: "grade", strict: true } } });
  });

  it("sends the rubric's cache key", async () => {
    expect(await sentBody("high")).toMatchObject({ prompt_cache_key: judgeCacheKey(REQUEST) });
  });

  it("stores nothing", async () => {
    expect(await sentBody("high")).toMatchObject({ store: false });
  });

  it("tries twice, then throws", async () => {
    const { client } = fakeClient(new Error("boom"), "not json");
    const judge = createJudge({ model: "gpt-6-sol", effort: "high", client });
    await expect(judge(REQUEST)).rejects.toThrow(/failed twice/);
  });
});

describe("judgeCacheKey", () => {
  it("is the same for another input", () => {
    const otherInput = { ...REQUEST, input: "other text" };
    expect(judgeCacheKey(otherInput)).toBe(judgeCacheKey(REQUEST));
  });

  it("changes with the rubric", () => {
    expect(judgeCacheKey({ ...REQUEST, instructions: "Grade it again." })).not.toBe(judgeCacheKey(REQUEST));
  });

  it("stays within OpenAI's 64-character limit for a long name", () => {
    expect(judgeCacheKey({ ...REQUEST, name: "x".repeat(80) }).length).toBeLessThanOrEqual(64);
  });
});
