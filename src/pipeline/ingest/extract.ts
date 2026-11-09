import OpenAI from "openai";

/**
 * One model call per newsletter issue: n8n's extraction prompt and output schema
 * (docs/n8n-backend/10-ingestion.md §4.4), moved from gpt-5.4-mini to gpt-6-luna.
 * Changes from n8n: no web search (links are resolved before the call and the model never used it),
 * the AlphaSignal "use websearch" rule is gone, the fallback date is a plain YYYY-MM-DD, and the schema
 * lists each category once.
 */

export const EXTRACTION_MODEL = "gpt-6-luna";

export const STORY_CATEGORIES = [
  "Launches",
  "Tools",
  "Analysis",
  "Funding",
  "Industry",
  "Policy",
  "Research",
  "Community",
  "Culture",
] as const;
export type StoryCategory = (typeof STORY_CATEGORIES)[number];

export interface ExtractedStory {
  category: StoryCategory;
  headline: string;
  summary: string;
  story_detail: string;
  published_at: string;
  url: string;
  importance_score: number;
}

export interface ExtractionInput {
  /** YYYY-MM-DD the model uses when a story shows no date of its own. */
  sourceDate: string;
  text: string;
}

export type Extractor = (input: ExtractionInput) => Promise<ExtractedStory[]>;

const SYSTEM_PROMPT =
  "You are an information extraction engine. Your only job is to extract news stories from newsletter text and return structured JSON. You do not editorialize. You do not summarize loosely. You apply rules mechanically.";

const USER_PROMPT = `Extract all qualifying news stories from the source text below.

---

## Step 1 — Filter Out

Discard any item that matches one or more of the following. Never extract these:

- Sponsored content: marked as "Presented By", "Together with", "SPONSOR", or "In partnership with"
- Sponsored events or webinars
- Tools or links marked with an asterisk (*) indicating sponsorship
- Lead magnets: demos, ebook downloads, free guides, whitepapers, waitlists with no news
- Newsletter self-promotion, referral links, or "how to use this newsletter" content
- Recurring sections with no news story (e.g. "Community workflow of the week", "tip of the day")
- Negative news: Any negative story about the effect or consequences of AI. For example a story on how AI would take the jobs of humans.

---

## Step 2 — Extract Each Qualifying Story

For each story, populate every field as follows:

### Headline
- Stay close to the original headline text if one exists
- If no headline exists, write a tight news headline (max 12 words) describing the event
- Never start with "How", "Why", or "What" — those are analysis framings, not news headlines
- Format in Title Case with the obvious exceptions like:
  - OpenAI, ChatGPT, macOS, iOS, xAI, AI, RAG, etc.

### Summary
- 1–2 sentences. What happened and why it matters.
- If a story covers multiple items (e.g. a list of tools), use markdown with inline links for each item
- Do not pad. Do not editorialize.

### Story Detail
- The full explanatory detail available in the source text, preserved faithfully
- Include any specific numbers, quotes, named parties, or technical specifics mentioned
- If the story details are vague or brief, story_detail may equal summary. Do not invent detail.
- Provide the output as a short editorial blurb without mentioning the source, page, listing, etc

### URL
- Prefer the direct link to the original source over the newsletter permalink
- If the story has a single clear source URL, use it
- If the story has multiple URLs (e.g. a roundup), leave url as empty string "" and embed links in summary using markdown
- If no external URL is present, use empty string ""

### Published At
- Use the article's own publication date if visible
- Otherwise use: {{SOURCE_DATE}}
- Format: YYYY-MM-DD

### Category

Assign exactly one. Apply the **first rule that matches** — do not use a later rule if an earlier one fits:

1. **Launches** — A genuinely new product, model, or market entry that is publicly available for the first time today. Must meet ALL of the following:
   - It is live and usable today (not just announced)
   - It did not previously exist — it is a new surface, not an update or feature addition to something already shipping
   - Examples that qualify: new model release, new standalone product, a known company entering a new market category for the first time (e.g. health AI, enterprise tier)
   - Examples that do NOT qualify: isolated feature additions or UX improvements to an existing product (these might go to tools instead)

2. **Research** — A paper, benchmark, technical finding, or dataset is the primary subject. Source is a lab, university, or technical publication. Use for:
- Academic or lab papers on new techniques, architectures, or findings
- Independent benchmark results from neutral third parties
- New public datasets released for research purposes
- Technical safety or alignment research from named institutions

3. **Funding** — Primary subject is a funding round, acquisition, valuation milestone, or IPO filing.

4. **Industry** — A strategic move, decision, or development from within the AI industry that is not a product launch, funding event, or policy action. Use this for:
   - Product shutdowns or discontinuations
   - Major partnerships or integrations between named companies
   - Leadership changes or high-profile hires at major companies
   - A company publicly reversing or contradicting a prior position
   - Competitive moves (one company directly responding to another)
   - Announcement of strategic direction from a major company
   - Internal controversies, leaks, or public disputes involving named organizations

5. **Policy** — A government body, regulator, or court has taken or announced a formal action regarding AI.

6. **Analysis** — Pure opinion, commentary, or market interpretation with no underlying news event. Use this only when there is no product launch, funding, industry move, or policy action driving the story. Use for:
- Opinion pieces and editorials
- Market forecasts and trend interpretations
- Explainers and "how X works" articles
- Interviews where the subject's views are the main content
- Commentary reacting to or interpreting an existing news event

7. **Tools** — A developer tool, library, API, or open-source repo. Also use for feature updates and minor changes to existing tools and products, only if they are live and usable today. If the change is announced, planned, previewed, rumored, or not yet shipped, do not use Tools. Consider using Industry.
Use for:
- New features added to existing consumer or developer products
- New APIs, SDKs, libraries, or open-source repos
- UX or quality-of-life improvements to existing tools
- Minor model updates or fine-tunes to already-shipping models
- New integrations between two existing products

8. **Community** — User stories, social moments, surveys, grassroots usage, or "how people are using AI" content.

9. **Culture** — Broader societal impact stories: AI and jobs, AI and creativity, AI and education, AI ethics debates without a specific policy action.

### Importance Score

Importance score measures newsworthiness within the AI industry. Assign a single integer 1–5. Use the **first level that fully matches**:

**Tier 1 company examples (for scoring):** OpenAI, Anthropic, Google/DeepMind, Meta AI, NVIDIA, Microsoft, Apple, Amazon/AWS, xAI

**5** — Assign if ANY of the following are true:
- A Tier 1 company ships a new standalone model, new product line, or enters a new market category today — where "new" means it did not previously exist, not an update or feature addition to something already shipping
- A benchmark or event that resets the field's narrative (e.g. a model leapfrogs all others, ARC-AGI release)
- A Tier 1 company dramatically pivots a significant product or strategy (shutdown, U-turn, public contradiction of prior position)
- A government body takes formal AI action affecting a major company or the industry broadly (ban, court ruling, executive order)
- A major safety incident, scandal, or public controversy involving a Tier 1 company

**4** — Assign if ANY of the following are true:
- A Tier 1 company makes a significant announcement about future plans for a new model, new product, or new market
- A Tier 1 company ships a meaningful capability expansion that is not a UI, QoL, or isolated feature update
- A well-known AI-native company (Cursor, Mistral, Perplexity, Cohere, Harvey, Hugging Face, Runway, ElevenLabs, Stability AI, Groq) ships something notable
- Funding or acquisition >$500M
- A well-known AI-native company kills or pivots a significant product
- A government action affecting a specific company but not the industry broadly
- A notable public disagreement, leak, or internal controversy from a named major player

**3** — A known AI-native company makes an announcement not yet shipped, OR a research paper with clear practical implications, OR funding $50M–$500M, OR a policy development with a named enforcement mechanism

**2** — Incremental update or new isolated feature added to an existing product (regardless of company tier), minor model release, small funding round, tooling from an unknown company, or analysis piece with no news event anchor

**1** — Opinion, evergreen explainer, job move, minor integration, event recap, or no clear news event

## Step 3 — Output

Return valid JSON matching the schema exactly. No explanation, no markdown wrapper, no commentary.

# Source Text:
`;

const STORIES_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          category: { type: "string", enum: [...STORY_CATEGORIES] },
          headline: { type: "string" },
          summary: { type: "string" },
          story_detail: { type: "string" },
          published_at: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
          url: { type: "string" },
          importance_score: { type: "integer", minimum: 1, maximum: 5 },
        },
        required: ["category", "headline", "summary", "story_detail", "published_at", "url", "importance_score"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

export function buildExtractionPrompt(input: ExtractionInput): string {
  return `${USER_PROMPT.replace("{{SOURCE_DATE}}", input.sourceDate)}${input.text}`;
}

function invalid(index: number, field: string): Error {
  return new Error(`model output does not match the schema (story ${index + 1}: ${field}).`);
}

export function parseExtractedStories(outputText: string): ExtractedStory[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText);
  } catch {
    throw new Error("model output is not valid JSON.");
  }
  const stories = (parsed as { stories?: unknown })?.stories;
  if (!Array.isArray(stories)) throw new Error("model output has no stories array.");

  return stories.map((value, index) => {
    const story = value as Record<string, unknown>;
    if (!STORY_CATEGORIES.includes(story.category as StoryCategory)) throw invalid(index, "category");
    for (const field of ["headline", "summary", "story_detail", "url"] as const) {
      if (typeof story[field] !== "string") throw invalid(index, field);
    }
    if (typeof story.published_at !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(story.published_at)) {
      throw invalid(index, "published_at");
    }
    const score = story.importance_score;
    if (typeof score !== "number" || !Number.isInteger(score) || score < 1 || score > 5) {
      throw invalid(index, "importance_score");
    }
    return {
      category: story.category as StoryCategory,
      headline: story.headline as string,
      summary: story.summary as string,
      story_detail: story.story_detail as string,
      published_at: story.published_at,
      url: story.url as string,
      importance_score: score,
    };
  });
}

/** The part of the OpenAI client this needs, so tests can pass a fake. */
export interface ResponsesClient {
  responses: { create(request: never): Promise<{ output_text?: string }> };
}

export function createOpenAIExtractor(options: { client?: ResponsesClient; apiKey?: string } = {}): Extractor {
  const client =
    options.client ??
    (new OpenAI({ apiKey: options.apiKey ?? process.env.OPENAI_API_KEY, timeout: 120_000, maxRetries: 1 }) as unknown as ResponsesClient);

  async function once(input: ExtractionInput): Promise<ExtractedStory[]> {
    const request = {
      model: EXTRACTION_MODEL,
      reasoning: { effort: "low" },
      instructions: SYSTEM_PROMPT,
      input: buildExtractionPrompt(input),
      store: false,
      text: {
        format: {
          type: "json_schema",
          name: "news_stories",
          strict: true,
          description:
            "Wrapper object containing all news stories extracted from a single input (e.g., a newsletter issue or article). Each story should represent one coherent piece of news and must come directly from the input, not be invented.",
          schema: STORIES_SCHEMA,
        },
      },
    };
    const response = await client.responses.create(request as never);
    return parseExtractedStories(response.output_text ?? "");
  }

  // One retry, for a failed call or output that does not match the schema.
  return async (input) => {
    try {
      return await once(input);
    } catch {
      try {
        return await once(input);
      } catch (error) {
        throw new Error(`Extraction failed twice: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };
}
