// The judge of the repeat check (src/pipeline/repeats/decisions.ts) on the labelled pairs: the fixture's labels and
// the new pairs' golden labels by Claude Opus (evals/repeats/golden.json). evals/README.md.
import { expect, it } from "vitest";

import { evalSettings } from "@/evals/lib/settings";
import { runSweep } from "@/evals/lib/sweep";
import { priceOf } from "@/evals/lib/usage";
import { loadGolden, missingGolden } from "@/evals/lib/golden";
import { GOLDEN_PATH } from "@/evals/repeats/golden";
import { goldenPairInput, labelledPairs, newPairItems, opusLabelledPairs, type PairGolden } from "@/evals/repeats/pairs";
import { levelOf, scoreRepeats, type PairOutput } from "@/evals/repeats/score";
import { createPairJudge, DECISIONS_MODEL } from "@/src/pipeline/repeats/decisions";

it("repeats: judge levels against the labelled pairs", async () => {
  // The Decisions API takes no effort, so the sweep is over EVAL_MODEL alone.
  const settings = evalSettings({ model: DECISIONS_MODEL, efforts: null, repeats: 1 });
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set.");
  const golden = loadGolden<PairGolden>(GOLDEN_PATH);
  const newItems = newPairItems();
  const missing = missingGolden(golden, newItems.map((item) => ({ id: item.id, input: goldenPairInput(item) })));
  const fixturePairs = labelledPairs();
  const opusPairs = opusLabelledPairs(golden, newItems);
  const pairs = [...fixturePairs, ...opusPairs];

  const { rows, path } = await runSweep({
    task: "repeats",
    title: "Repeat check eval",
    notes: [
      `The Decisions API judge of the repeat check on ${pairs.length} labelled pairs: the ${fixturePairs.length} of ` +
        "`src/pipeline/repeats/__fixtures__/labelled-pairs.jsonl` (labels by a strong model; see its README.md), and " +
        `${opusPairs.length} of \`evals/repeats/new-pairs.json\` with golden labels by Claude Opus by the same rules ` +
        `(\`evals/repeats/golden.json\`; ${missing.length} new pairs have none yet and are left out). One request for ` +
        "each pair. Levels use the thresholds in `repeat-rules.ts`: sure, similar, or none.",
      "The Decisions API takes no reasoning effort and accepts only gpt-6-luna today, so the sweep is over the model alone. " +
        "It does not charge output tokens.",
    ],
    settings,
    items: pairs,
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
      labelSource: outcome.item.labelSource,
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
