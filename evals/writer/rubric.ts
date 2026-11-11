import { CANDIDATE_SECTION_CONFIGS } from "@/src/features/newsletter/section-config";
import { CONTENT_SECTION_KEYS, type WrittenIssueContent } from "@/src/pipeline/draft/content";
import { buildWriterPrompt, type WriterInput } from "@/src/pipeline/draft/writer";

/** The judge's rubric, schemas and inputs for the writer eval. The judge is gpt-6-sol (evals/lib/judge.ts). */

export const GRADE_INSTRUCTIONS = `You grade one written issue of AI Recap, a weekday AI newsletter that should read like a high-end editorial daily briefing: authoritative and warm, not corporate or SaaS-y.

You get the writer's exact input (SOURCE: every story with its headline, summary, story_details, url, note, and for feature stories the article_text, which may be null when the article could not be read) and then the DRAFT the writer returned. Grade the DRAFT against the SOURCE only. Do not use outside knowledge: a true fact that is not in the SOURCE is still unsupported.

Return one entry in "stories" for every story in the DRAFT, in the DRAFT's order (headlines, research_and_analysis, tools, quick_hits).

unsupported_claims (per story, and once for title + excerpt + overview together): count the distinct factual claims that the SOURCE does not support for that story. A claim is a statement of fact: a number, name, date, capability, comparison, cause, quote, motive, timeline, or implication. Count a claim as unsupported if it is absent from that story's SOURCE fields, contradicts them, or overstates them (for example "beats GPT-6" when the source says "matches"; "will" when the source says "may"). Do not count pure framing with no factual content ("a notable step", "worth watching"), or faithful paraphrase. Count each distinct claim once. Most good drafts have 0 to 2 in the whole issue.

bullets (feature stories only: headlines and research_and_analysis; an empty list for tools and quick_hits): one entry per bullet, in order.
- distinct_from_detail: true if the bullet adds a fact or insight that the same story's story_detail does not already state. Rewording story_detail is false.
- from_article_text: true if the bullet's main fact appears in the story's article_text and NOT in its summary or story_details. False when article_text is null.

note: "no_note" if the story's SOURCE note is empty. Otherwise "followed" if the written item does what the note asks and does not mention or quote the note; "mentioned" if it follows it but refers to the note or the editor; "not_followed" otherwise.

editorial_quality (1 to 5, the whole issue: title, excerpt, overview, headlines, prose):
5 = a top editorial briefing: specific, crisp, confident and warm; headlines sharp; the overview hooks with real news; no filler or repetition.
4 = strong, with a few flat, wordy or repetitive lines.
3 = competent but generic: bland headlines, filler phrases, repeated sentence shapes, or a weak overview.
2 = often clunky, vague, salesy or SaaS-like, or with meta-commentary about the newsletter or the input.
1 = not publishable.
quality_reason: one or two sentences naming the main reason for the score.

Return only JSON that matches the schema.`;

const NOTE_VALUES = ["no_note", "followed", "mentioned", "not_followed"] as const;
export type NoteGrade = (typeof NOTE_VALUES)[number];

export interface StoryGrade {
  story_id: number;
  unsupported_claims: number;
  bullets: Array<{ distinct_from_detail: boolean; from_article_text: boolean }>;
  note: NoteGrade;
}

export interface IssueGrade {
  stories: StoryGrade[];
  intro_unsupported_claims: number;
  editorial_quality: number;
  quality_reason: string;
}

export const GRADE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["stories", "intro_unsupported_claims", "editorial_quality", "quality_reason"],
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["story_id", "unsupported_claims", "bullets", "note"],
        properties: {
          story_id: { type: "integer" },
          unsupported_claims: { type: "integer", description: "Distinct factual claims the SOURCE does not support." },
          bullets: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              required: ["distinct_from_detail", "from_article_text"],
              properties: { distinct_from_detail: { type: "boolean" }, from_article_text: { type: "boolean" } },
            },
          },
          note: { type: "string", enum: NOTE_VALUES },
        },
      },
    },
    intro_unsupported_claims: { type: "integer", description: "Unsupported claims in the title, excerpt and overview together." },
    editorial_quality: { type: "integer", description: "1 to 5, by the anchors." },
    quality_reason: { type: "string" },
  },
} as const;

/** The source first, the same for every effort, so repeated grades of one issue can reuse the prompt cache. */
export function gradeInput(input: WriterInput, draft: WrittenIssueContent): string {
  return `SOURCE (the writer's exact input):\n${buildWriterPrompt(input)}\n\nDRAFT:\n${JSON.stringify(draft, null, 2)}`;
}

export const PAIR_INSTRUCTIONS = `You are the editor-in-chief of AI Recap, a weekday AI newsletter that should read like a high-end editorial daily briefing: authoritative and warm, not corporate or SaaS-y.

Two writers drafted the same issue from the same stories. You get the STORIES (headline, summary, story_details and the editor's note for each; the article text is left out) and DRAFT A and DRAFT B. Decide which draft you would rather send to readers as it is.

Weigh, in this order: accuracy to the stories (no invented or overstated facts), following each note, clarity and specificity, editorial voice (crisp, confident, warm), and how well the title and overview make a reader want to read on. Ignore length unless it hurts the reader. The drafts' order is random: do not favour A or B for its position.

Answer "tie" only when you truly cannot choose. Give a one-sentence reason. Return only JSON that matches the schema.`;

export interface PairGrade {
  winner: "A" | "B" | "tie";
  reason: string;
}

export const PAIR_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["winner", "reason"],
  properties: { winner: { type: "string", enum: ["A", "B", "tie"] }, reason: { type: "string" } },
} as const;

/** The stories without article text: the pairwise judge compares the drafts' writing, the grade checks the facts. */
export function pairInput(input: WriterInput, a: WrittenIssueContent, b: WrittenIssueContent): string {
  const stories = Object.fromEntries(
    CANDIDATE_SECTION_CONFIGS.map((config) => [
      CONTENT_SECTION_KEYS[config.key],
      input.sections[config.key].map((story) => ({
        id: story.id,
        headline: story.headline,
        summary: story.summary,
        story_details: story.storyDetails ?? "",
        note: story.note,
      })),
    ])
  );
  return `STORIES:\n${JSON.stringify(stories, null, 2)}\n\nDRAFT A:\n${JSON.stringify(a, null, 2)}\n\nDRAFT B:\n${JSON.stringify(b, null, 2)}`;
}
