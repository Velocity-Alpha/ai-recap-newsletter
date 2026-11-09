import OpenAI from "openai";

import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import {
  CONTENT_SECTION_KEYS,
  FEATURE_SECTIONS,
  WRITTEN_ISSUE_SCHEMA,
  parseWrittenIssue,
  type ApprovedSections,
  type ApprovedStory,
  type WrittenIssueContent,
} from "@/src/pipeline/draft/content";

/**
 * One model call writes the issue: n8n's "Reformat Stories for Issue" prompt and schema
 * (docs/n8n-backend/20-drafting-and-images.md §1.6), moved from gpt-5.5 to gpt-6-luna.
 * Changes from n8n:
 * - no web search: feature stories carry the article text the article reader saved instead;
 * - stories arrive already grouped by section, in board order, and keep that order;
 * - plain text in every field, exactly 3 bullets per feature story, no `title_emoji`, a new `excerpt`;
 * - no story may be dropped (n8n allowed omitting thin stories), and story ids are numbers.
 */

export const WRITER_MODEL = "gpt-6-luna";

/** Article text beyond this is cut, so 8 feature stories stay well inside the model's context. */
export const MAX_ARTICLE_CHARS = 20_000;

/** The article reader's result for one feature-section story. */
export type ArticleText = { storyId: number; text: string } | { storyId: number; unread: true };

export interface WriterInput {
  /** Approved stories by section, in board order, with link edits and notes applied. */
  sections: ApprovedSections;
  /** The story the subject line is based on. */
  leadStoryId: number | null;
  /** Article text for feature-section stories. A story with no entry counts as not read. */
  articles?: ArticleText[];
}

export type IssueWriter = (input: WriterInput) => Promise<WrittenIssueContent>;

const SYSTEM_PROMPT = `You are the editorial structuring engine for an AI newsletter.

Your job is to transform a set of raw story objects into a single structured newsletter object that matches the caller-provided JSON schema exactly.

You must follow these rules:

1. Output
- Return only valid JSON.
- Do not wrap the JSON in markdown.
- Do not include explanations, notes, or extra keys.
- Respect the schema exactly.

2. Grounding
- Use only facts present in the input: each story's fields and, for feature stories, its article_text.
- Do not invent details, quotes, numbers, motivations, timelines, or implications that are not strongly supported by the input.
- If a story is thin, write less about it. Never drop it and never guess.
- Preserve each story's url exactly, character for character.

3. Sections
- The input groups stories into headlines, research_and_analysis, tools, and quick_hits. The editor chose these sections.
- Put every input story in the output section with the same name, exactly once.
- Never move a story to another section, merge two stories, or add a story that is not in the input.
- Keep the input order within each section.

4. Editorial goals
- The output should read like a sharp, modern AI newsletter.
- Clean up truncation conservatively without adding new facts.
- Remove source-attribution filler such as "reported by", "according to", "official post", "announced via", newsletter names, or platform references.
- Remove references like "this update", "our newsletter", or "social media post".
- Never comment on the input itself, such as what a summary says or that details are missing.
- A story's note is the editor's instruction for that story. Follow it, but never quote or mention it.
- Keep phrasing crisp and informative.

5. Writing constraints
- Never use em dashes.
- Never use ellipses.
- Use plain text only in every string field.
- Do not include markdown (links, bullets, bold, headings), HTML, URLs, emoji, or code formatting inside string fields.
- Keep repetition low.

6. Title rules
- "title" is the newsletter subject line.
- It is based on the story whose id is lead_story_id.
- It must be 4 to 8 words.
- If lead_story_id is null, base it on the SINGLE strongest story in headlines.
- No emoji.

7. Excerpt rules
- "excerpt" is 1 to 2 sentences that tease the issue's biggest news on the website and in link previews.
- Write about the news itself. No greeting, and no meta-commentary such as "In this issue".

8. Overview rules
- Persona: Act as a friendly newsletter editor writing a short introduction. Speak directly to the reader.
- Structure: Start with a simple greeting (e.g., "Good morning,"). End with a quick transition into the content (e.g., "Let's dive in.").
- The Hook: Do not try to summarize the entire issue. Instead, pick the 2-3 most interesting stories and write a catchy, plain-spoken hook about what is happening.
- Tone: Human, direct, and casual.
- Prohibitions: Never write meta-commentary about the newsletter. Absolutely ban phrases like "This issue is dominated by," "Today we look at," or "This issue covers."
- Length: Strictly 45 to 80 words.

9. Headlines and research_and_analysis rules
For each feature item:
- "story_id" must be copied from the input story id, as a number.
- "url" must be copied exactly.
- "headline" should be clear, human, and polished.
- "story_detail" should be 2 to 4 sentences and feel like newsletter body copy.
- "bullets" must contain exactly 3 items.
- Each bullet must use:
  - "before" for the lead-in text
  - "highlight" for the emphasized phrase
  - "after" for the trailing text
- Keep "highlight" short, concrete, and meaningful. It must never be empty.
- The bullets must not repeat information in story_detail. Use the article_text to find distinct, deeper insights or data points.
- When article_text is null, the article could not be read. Build each bullet from a concrete fact in the story's summary or story_details, without inventing. Keep those bullets short.

10. Tools rules
For each tools item:
- "story_id" must be copied from the input story id, as a number.
- "url" must be copied exactly.
- "link_text" should usually be the product, repo, or tool name.
- "detail" should be one brief supporting sentence fragment or short sentence.
- Keep it concise and useful.

11. Quick hits rules
For each quick_hits item:
- "story_id" must be copied from the input story id, as a number.
- "url" must be copied exactly.
- "link_text" should be short and scannable.
- "text" should read as the continuation of a sentence after the linked text.
- Keep it compact.

Return only the final JSON object.`;

const USER_PROMPT_HEAD = `Create the structured newsletter object for this issue.

Use the caller-provided JSON schema exactly.

Additional instructions for this run:
- Preserve every story URL exactly.
- Keep every story in its section, in the given order. Do not leave any story out.
- Keep all prose fields plain text only.
- Every feature item (headlines and research_and_analysis) must have exactly 3 bullets. The content of these bullets must not repeat information found in the story_detail. They must provide distinct, deeper insights or data points from the story's article_text.
- There is a note field for every story. If the note field of a story is not empty, use what is present in the note field to guide your editing / reformatting of the story.

- Use only the input stories below.
`;

const SECTION_KEYS = CANDIDATE_SECTION_CONFIGS.map((config) => config.key);

function isFeatureSection(key: SectionKey): boolean {
  return (FEATURE_SECTIONS as readonly SectionKey[]).includes(key);
}

function articleTextById(articles: ArticleText[] = []): Map<number, string> {
  const texts = new Map<number, string>();
  for (const article of articles) {
    if ("text" in article && article.text.trim()) texts.set(article.storyId, article.text.trim());
  }
  return texts;
}

function storyForPrompt(story: ApprovedStory, articleText: string | null | undefined) {
  return {
    id: story.id,
    headline: story.headline,
    summary: story.summary,
    story_details: story.storyDetails ?? "",
    url: story.url,
    note: story.note,
    ...(articleText === undefined ? {} : { article_text: articleText }),
  };
}

export function buildWriterPrompt(input: WriterInput): string {
  const texts = articleTextById(input.articles);
  const payload = Object.fromEntries(
    SECTION_KEYS.map((key) => [
      CONTENT_SECTION_KEYS[key],
      input.sections[key].map((story) =>
        storyForPrompt(
          story,
          isFeatureSection(key) ? (texts.get(story.id)?.slice(0, MAX_ARTICLE_CHARS) ?? null) : undefined
        )
      ),
    ])
  );
  return `${USER_PROMPT_HEAD}${JSON.stringify(payload, null, 2)}\nlead_story_id: ${input.leadStoryId ?? "null"}`;
}

/** Feature-section stories whose article was not read, in board order. The draft saves these. */
export function unreadArticleStoryIds(sections: ApprovedSections, articles?: ArticleText[]): number[] {
  const texts = articleTextById(articles);
  return FEATURE_SECTIONS.flatMap((key) => sections[key].map((story) => story.id)).filter((id) => !texts.has(id));
}

function inBoardOrder<T extends { story_id: number }>(items: T[], stories: ApprovedStory[]): T[] {
  const position = new Map(stories.map((story, index) => [story.id, index]));
  const rank = (item: T) => position.get(item.story_id) ?? Number.MAX_SAFE_INTEGER;
  return [...items].sort((a, b) => rank(a) - rank(b));
}

function toBoardOrder(content: WrittenIssueContent, sections: ApprovedSections): WrittenIssueContent {
  return {
    ...content,
    headlines: inBoardOrder(content.headlines, sections.headlines),
    research_and_analysis: inBoardOrder(content.research_and_analysis, sections.research),
    tools: inBoardOrder(content.tools, sections.tools),
    quick_hits: inBoardOrder(content.quick_hits, sections.quickHits),
  };
}

interface WriterResponse {
  status?: string;
  incomplete_details?: { reason?: string } | null;
  output_text?: string;
  output?: Array<{ type?: string; content?: Array<{ type?: string; refusal?: string }> }>;
}

/** The part of the OpenAI client this needs, so tests can pass a fake. */
export interface ResponsesClient {
  responses: { create(request: never): Promise<WriterResponse> };
}

function refusalOf(response: WriterResponse): string | null {
  for (const item of response.output ?? []) {
    for (const part of item.content ?? []) {
      if (part.type === "refusal") return part.refusal ?? "no reason given";
    }
  }
  return null;
}

export function createOpenAIIssueWriter(options: { client?: ResponsesClient; apiKey?: string } = {}): IssueWriter {
  const client =
    options.client ??
    (new OpenAI({
      apiKey: options.apiKey ?? process.env.OPENAI_API_KEY,
      timeout: 240_000,
      maxRetries: 1,
    }) as unknown as ResponsesClient);

  return async (input) => {
    const request = {
      model: WRITER_MODEL,
      reasoning: { effort: "low" },
      instructions: SYSTEM_PROMPT,
      input: buildWriterPrompt(input),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "issue_content",
          strict: true,
          description: "The written newsletter issue: subject line, excerpt, overview, and every approved story by section.",
          schema: WRITTEN_ISSUE_SCHEMA,
        },
      },
    };
    const response = await client.responses.create(request as never);

    if (response.status === "incomplete") {
      throw new Error(`The writer stopped before finishing (${response.incomplete_details?.reason ?? "no reason given"}).`);
    }
    const refusal = refusalOf(response);
    if (refusal) throw new Error(`The writer refused: ${refusal}`);

    return toBoardOrder(parseWrittenIssue(response.output_text ?? ""), input.sections);
  };
}
