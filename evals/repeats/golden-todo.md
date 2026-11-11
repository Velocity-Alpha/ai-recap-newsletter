# Repeat check: golden work list

For a Claude Opus agent. One golden label per new pair of `evals/repeats/new-pairs.json` (60 pairs). The 243
pairs of `src/pipeline/repeats/__fixtures__/labelled-pairs.jsonl` keep their labels: do not label them again.
The labels go in `evals/repeats/golden.json`, which is committed: pair ids, labels and a short reason of your own
words only. No web search is needed: judge from the text you are given.

## Why a separate golden file

The new labels are in `evals/repeats/golden.json`, in the shape of `evals/lib/golden.ts`, not appended to
`labelled-pairs.jsonl`. So the fixture's labels keep their provenance (its README), each new label says who made it
and when (`producer`, `date`), and its `inputHash` makes the eval refuse a label whose stories changed since.

## Before you start

1. Run `npm run eval:build -- evals/repeats/golden-inputs.ts`. It writes
   `evals/data/repeats/golden-inputs/<newer>-<older>.json` for each new pair and `_rules.md`.
2. Read `evals/data/repeats/golden-inputs/_rules.md`. It holds the labelling rules the fixture's labels were made
   with, word for word. Follow them exactly; do not copy them into this file.

## For each pair

Work pair by pair. Skip a pair that already has an entry whose `inputHash` equals the one in its input file.

1. Open `golden-inputs/<newer>-<older>.json`. `input.newer` is Story A, `input.older` is Story B: `id`, `headline`
   and `summary` (our own text).
2. Read both stories. Judge only from this text. Do not look at the recorded answers in `new-pairs.json` or
   `judged-pairs.jsonl` (`same`, `news`, `picked`): they are what the eval tests or how the pair was picked.
3. Pick the one label of `_rules.md` that fits. Ask in order: is it the same underlying development? If not, is it
   the same specific story line with something materially new in the newer story? Otherwise it is different.
4. Pick a confidence from `_rules.md`: `high` when the text leaves no doubt, `medium` when one reading is clearly
   better, `low` when the text could fairly support another label (for example a summary too short to tell).
5. Write `why`: one short sentence in your own words that names the two developments, like the `why` of
   `labelled-pairs.jsonl`. Never copy article text.

## Writing an entry

Add the entry under `entries` in `evals/repeats/golden.json`, keyed by the pair id `<newer>-<older>`:

```json
"10081-9963": {
  "inputHash": "<the inputHash of golden-inputs/10081-9963.json>",
  "date": "YYYY-MM-DD",
  "value": { "label": "same", "confidence": "high", "why": "Both report ..." }
}
```

- `inputHash` is `hashInput(input)` (`evals/lib/golden.ts`); the input file already holds it. Copy it.
- `date` is the day you labelled the pair.
- Keep the file valid JSON. Do not change other entries or the `about` and `producer` fields.

## Check your entries

Run `npx vitest run evals/repeats/golden.test.ts`. It fails on an entry for a pair that is not new, a stale
`inputHash`, or a label, confidence or reason of the wrong shape. Fix each entry it names.
