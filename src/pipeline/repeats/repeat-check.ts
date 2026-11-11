import { createPairJudge } from "@/src/pipeline/repeats/decisions";
import { createEmbeddingsClient, embedTexts, type EmbeddingsClient } from "@/src/pipeline/repeats/embed";
import { matchStories, type MatchCounts } from "@/src/pipeline/repeats/match-stories";
import { createPrismaRepeatsStore, readRepeatWindowDays } from "@/src/pipeline/repeats/repeats-store";

/**
 * The repeat check with its real services: OpenAI embeddings, the Decisions API and the database. The ingest job
 * runs it on the stories of the last days; the board runs it on candidates that are still unchecked.
 */

export interface RepeatCheckResult extends MatchCounts {
  /** The story ids asked for. Stories checked before are skipped. */
  checked: number;
  /** Judge requests that failed. Their stories keep `matched_at` null and are tried again. */
  failed?: { count: number; firstError: string };
}

export type RepeatCheck = (storyIds: number[]) => Promise<RepeatCheckResult>;

export function createRepeatCheck(options: { apiKey: string }): RepeatCheck {
  // Made on first use: the OpenAI client throws without a key, and most calls embed nothing.
  let client: EmbeddingsClient | undefined;
  const judge = createPairJudge({ apiKey: options.apiKey });
  return async (storyIds) => {
    const errors: string[] = [];
    const counts = await matchStories(storyIds, {
      store: createPrismaRepeatsStore(),
      embed: (texts) => embedTexts(texts, { client: (client ??= createEmbeddingsClient({ apiKey: options.apiKey })) }),
      judge,
      windowDays: await readRepeatWindowDays(),
      onJudgeError: (_newerId, error) => errors.push(error instanceof Error ? error.message : String(error)),
    });
    return {
      checked: storyIds.length,
      ...counts,
      ...(errors.length > 0 ? { failed: { count: errors.length, firstError: errors[0] } } : {}),
    };
  };
}
