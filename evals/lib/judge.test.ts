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

describe("createJudge", () => {
  it("sends the rubric first with a stable cache key, strict JSON and the judge's effort", async () => {
    const { client, create } = fakeClient('{"ok":true}');
    const judge = createJudge({ model: "gpt-6-sol", effort: "high", client });
    await expect(judge(REQUEST)).resolves.toEqual({ ok: true });
    expect((create.mock.calls[0] as unknown[])[0]).toMatchObject({
      model: "gpt-6-sol",
      reasoning: { effort: "high" },
      instructions: "Grade it.",
      input: "the text",
      prompt_cache_key: judgeCacheKey(REQUEST),
      store: false,
      text: { format: { type: "json_schema", name: "grade", strict: true } },
    });
  });

  it("keys the cache by rubric and schema, not by input", () => {
    const key = judgeCacheKey(REQUEST);
    const otherInput = { ...REQUEST, input: "other text" };
    expect(judgeCacheKey(otherInput)).toBe(key);
    expect(judgeCacheKey({ ...REQUEST, instructions: "Grade it again." })).not.toBe(key);
    expect(judgeCacheKey({ ...REQUEST, name: "x".repeat(80) }).length).toBeLessThanOrEqual(64);
  });

  it("tries twice, then throws", async () => {
    const { client } = fakeClient(new Error("boom"), "not json");
    const judge = createJudge({ model: "gpt-6-sol", effort: "high", client });
    await expect(judge(REQUEST)).rejects.toThrow(/failed twice/);
  });
});
