/** Text counts shared by the evals. Words are counted as the draft checks count them (validate.ts). */
export { countWords } from "@/src/pipeline/draft/validate";

/** Sentences in a plain-text field: ends of sentence followed by a space and a capital, digit or quote. */
export function countSentences(text: string): number {
  return text
    .trim()
    .split(/(?<=[.!?])\s+(?=["'A-Z0-9])/)
    .filter((part) => /[\p{L}\p{N}]/u.test(part)).length;
}
