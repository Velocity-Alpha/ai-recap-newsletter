/**
 * The golden file of section scoring (#177): the owner's labels, keyed by story id, in the shape of the other golden
 * files (evals/lib/golden.ts). It holds ids, labels and reasons, never story text. The repo is public, so reasons
 * must hold no private detail.
 */
import type { Golden } from "@/evals/lib/golden";
import type { Kind, LabelExport, LabelState, Recommendation } from "@/evals/section-scoring/labels";

/** The fixed sets of evals/section-scoring/sets.json: the check set and each tuning batch, by story id. */
export interface Sets {
  about: string;
  seed: number;
  /** The days of the stories the sets are picked from, YYYY-MM-DD. */
  window: { from: string; to: string };
  /** Never tuned on. `hidden` are shown with no recommendation. */
  check: { ids: number[]; hidden: number[] };
  batches: { batch: string; scoringVersion: string; picked: string; ids: number[] }[];
}

export const CHECK_BATCH = "check";

export interface GoldenLabel {
  set: "tuning" | "check";
  /** "tuning-1", "tuning-2", … or "check". */
  batch: string;
  /** The scoring version whose recommendation the page showed. */
  scoringVersion: string;
  /** Null when the page showed no recommendation. */
  recommendation: Recommendation | null;
  kind: Kind;
  also: Kind | null;
  importance: number | null;
  state: LabelState;
  reason: string;
}

export function emptyGolden(): Golden<GoldenLabel> {
  return {
    about:
      "Section-scoring golden set (#177): per story id, the owner's kind, 'also fits', importance (1 to 5) and state (confirmed, overridden, either, unprompted), with the reason on an override. set says tuning or check; never tune on check. inputHash is the hash of the headline, summary and source the owner saw.",
    producer: "owner",
    entries: {},
  };
}

/** The golden file with the exported labels added. A newer label of a story replaces the older one. */
export function addLabels(golden: Golden<GoldenLabel>, exported: LabelExport, sets: Sets): Golden<GoldenLabel> {
  const isCheck = exported.batch === CHECK_BATCH;
  const ids = isCheck ? sets.check.ids : sets.batches.find((batch) => batch.batch === exported.batch)?.ids;
  if (!ids) throw new Error(`Batch "${exported.batch}" is not in sets.json.`);
  const inBatch = new Set(ids);
  const entries = { ...golden.entries };
  for (const { storyId, inputHash, recommendation, label } of exported.labels) {
    if (!inBatch.has(storyId)) throw new Error(`Story ${storyId} is not in batch "${exported.batch}".`);
    entries[storyId] = {
      inputHash,
      date: label.labeledAt.slice(0, 10),
      value: {
        set: isCheck ? "check" : "tuning",
        batch: exported.batch,
        scoringVersion: exported.scoringVersion,
        recommendation,
        kind: label.kind,
        also: label.also,
        importance: label.importance,
        state: label.state,
        reason: label.reason,
      },
    };
  }
  return { ...golden, entries };
}
