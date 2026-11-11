import { countSentences, countWords } from "@/evals/lib/text";
import type { ApprovedSections, WrittenIssueContent } from "@/src/pipeline/draft/content";
import type { WriterInput } from "@/src/pipeline/draft/writer";

/**
 * The Neon dev branch has no owner notes for these issues, so the eval adds the same editor's notes to every
 * issue: our own words, each one checkable in code. A story that already has a note keeps it.
 */

export interface EvalNote {
  section: keyof ApprovedSections;
  /** Place in the section, from 0. */
  index: number;
  note: string;
  /** Did the written item follow the note? Gets the item of the story in the written content. */
  followed: (content: WrittenIssueContent, storyId: number) => boolean;
}


function feature(content: WrittenIssueContent, storyId: number) {
  return [...content.headlines, ...content.research_and_analysis].find((item) => item.story_id === storyId);
}

export const EVAL_NOTES: EvalNote[] = [
  {
    section: "headlines",
    index: 1,
    note: "Keep the story detail to two sentences.",
    followed: (content, id) => {
      const item = feature(content, id);
      return item !== undefined && countSentences(item.story_detail) <= 2;
    },
  },
  {
    section: "research",
    index: 0,
    note: "Write the headline as a question.",
    followed: (content, id) => feature(content, id)?.headline.trim().endsWith("?") ?? false,
  },
  {
    section: "quickHits",
    index: 0,
    note: "Keep this one under 12 words in total.",
    followed: (content, id) => {
      const item = content.quick_hits.find((hit) => hit.story_id === id);
      return item !== undefined && countWords(`${item.link_text} ${item.text}`) < 12;
    },
  },
];

/** The input with the eval's notes on the stories that exist and have no note. Does not change the input. */
export function withEvalNotes(input: WriterInput): { input: WriterInput; noted: Array<{ storyId: number; note: EvalNote }> } {
  const sections = Object.fromEntries(
    Object.entries(input.sections).map(([key, stories]) => [key, stories.map((story) => ({ ...story }))])
  ) as unknown as ApprovedSections;
  const noted: Array<{ storyId: number; note: EvalNote }> = [];
  for (const note of EVAL_NOTES) {
    const story = sections[note.section][note.index];
    if (!story || story.note.trim()) continue;
    story.note = note.note;
    noted.push({ storyId: story.id, note });
  }
  return { input: { ...input, sections }, noted };
}
