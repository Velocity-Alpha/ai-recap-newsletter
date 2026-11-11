import { createHash } from "node:crypto";

import type { EffortSetting } from "@/evals/lib/settings";
import type { RecordingClient } from "@/evals/lib/usage";

export interface JudgeRequest {
  /** The schema's name, for example "story_grade". */
  name: string;
  /** What to judge and how: the rubric. It goes first, so OpenAI can cache it across calls. */
  instructions: string;
  /** The text to judge. */
  input: string;
  /** A strict JSON schema: every property required, `additionalProperties: false`. */
  schema: Record<string, unknown>;
}

/** Asks the judge model for a grade in strict JSON. Tries twice, then throws. */
export type Judge = <T>(request: JudgeRequest) => Promise<T>;

/** One `prompt_cache_key` per rubric and schema, so calls with the same rubric land on the same cache. */
export function judgeCacheKey(request: Pick<JudgeRequest, "name" | "instructions" | "schema">): string {
  const hash = createHash("sha256").update(request.instructions).update(JSON.stringify(request.schema)).digest("hex").slice(0, 16);
  return `eval-judge:${request.name.slice(0, 32)}:${hash}`;
}

/** A judge on EVAL_JUDGE_MODEL (default gpt-6-sol, high effort). Its usage goes to its client's recorder. */
export function createJudge(options: { model: string; effort: EffortSetting; client: RecordingClient }): Judge {
  return async <T>(request: JudgeRequest): Promise<T> => {
    const body = {
      model: options.model,
      ...(options.effort ? { reasoning: { effort: options.effort } } : {}),
      instructions: request.instructions,
      input: request.input,
      prompt_cache_key: judgeCacheKey(request),
      store: false,
      text: { format: { type: "json_schema", name: request.name, strict: true, schema: request.schema } },
    };
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const response = await options.client.responses.create(body as never);
        return JSON.parse(response.output_text ?? "") as T;
      } catch (error) {
        lastError = error;
      }
    }
    throw new Error(`The judge failed twice: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
  };
}
