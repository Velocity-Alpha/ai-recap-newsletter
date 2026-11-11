// Builds evals/repeats/new-pairs.json: the pairs added to the repeat check's test set, picked from the committed
// recorded pairs of src/pipeline/repeats/__fixtures__/ that have no label (new-pairs.ts). No database or network:
// the fixture's stories (from the stories table, its README) and their nearest-story pairs are already committed.
//
// Usage: npm run eval:build -- evals/repeats/build-pairs.ts

import { writeFileSync } from "node:fs";

import { NEW_PAIRS_PATH, pickNewPairs, PICKS, SIMILARITY_BANDS, type Block, type NewPairsFile, type RecordedPair } from "@/evals/repeats/new-pairs";
import { readJsonl } from "@/evals/repeats/pairs";

function main() {
  const recorded = readJsonl<RecordedPair>("judged-pairs.jsonl").map(({ newer, older, similarity, rank, same, news }) => ({
    newer,
    older,
    similarity,
    rank,
    same,
    news,
  }));
  const labelled = readJsonl<{ a: number; b: number }>("labelled-pairs.jsonl");
  const pairs = pickNewPairs(recorded, labelled, readJsonl<Block>("blocks.jsonl"));
  const counts = Object.keys(PICKS).map((reason) => `${pairs.filter((pair) => pair.picked === reason).length} ${reason}`);
  const file: NewPairsFile = {
    note:
      `${pairs.length} pairs of src/pipeline/repeats/__fixtures__/judged-pairs.jsonl with no label in labelled-pairs.jsonl, ` +
      `picked by evals/repeats/build-pairs.ts: ${counts.join(", ")}. haiku_*: a pair Claude Haiku grouped as the same ` +
      "news, marked a follow-up, or was unsure of (blocks.jsonl); similarity: spread over the bands " +
      `${SIMILARITY_BANDS.map((band) => `${band.from}-${Math.min(1, band.to)}`).join(", ")}. Within a kind, spread over ` +
      "similarity. The labels are Claude Opus's, in evals/repeats/golden.json.",
    pairs,
  };
  writeFileSync(NEW_PAIRS_PATH, `${JSON.stringify(file, null, 2)}\n`);
  console.info(`Wrote ${pairs.length} pairs to ${NEW_PAIRS_PATH}: ${counts.join(", ")}.`);
}

main();
