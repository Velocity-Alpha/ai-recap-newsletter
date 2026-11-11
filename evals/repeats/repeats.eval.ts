// The judge of the repeat check (src/pipeline/repeats/decisions.ts) on the labelled pairs. evals/README.md.
import { expect, it } from "vitest";

import { evalSettings } from "@/evals/lib/settings";
import { runSweep } from "@/evals/lib/sweep";
import { priceOf } from "@/evals/lib/usage";
import { labelledPairs } from "@/evals/repeats/pairs";
import { levelOf, scoreRepeats, type PairOutput } from "@/evals/repeats/score";
import { createPairJudge, DECISIONS_MODEL } from "@/src/pipeline/repeats/decisions";

it("repeats: judge levels against the labelled pairs", async () => {
  // The Decisions API takes no effort, so the sweep is over EVAL_MODEL alone.
  const settings = evalSettings({ model: DECISIONS_MODEL, efforts: null, repeats: 1, concurrency: 8 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");

  const { rows, path } = await runSweep({
    task: "repeats",
    title: "Repeat check eval",
    notes: [
      "The Decisions API judge of the repeat check on the 243 labelled pairs of `src/pipeline/repeats/__fixtures__/` " +
        "(labels by a strong model; see its README.md). One request for each pair. Levels use the thresholds in " +
        "`repeat-rules.ts`: sure, similar, or none.",
      "The Decisions API takes no reasoning effort and accepts only gpt-6-luna today, so the sweep is over the model alone. " +
        "It does not charge output tokens.",
    ],
    settings,
    items: labelledPairs(),
    id: (pair) => pair.id,
    async run(pair, context): Promise<PairOutput> {
      const judge = createPairJudge({ apiKey, model: context.config.model, fetch: context.fetch });
      const [answer] = await judge(pair.newer, [pair.older]);
      return answer ? { same: answer.same, news: answer.news } : { refused: true };
    },
    score: scoreRepeats,
    raw: (outcome) => ({
      label: outcome.item.label,
      confidence: outcome.item.confidence,
      ...(outcome.output ?? {}),
      level: outcome.output ? levelOf(outcome.output) : null,
    }),
    price: (model) => {
      const price = priceOf(model);
      return price && { ...price, output: 0 };
    },
  });

  console.info(`Wrote ${path}`);
  expect(rows).toHaveLength(1);
});
