import { createHash } from "crypto";

/**
 * First draft of "sections as data" (#176), for the scoring test only. The definitions are written from today's
 * extraction rules (`src/pipeline/ingest/extract.ts`) and are to tune with the owner.
 *
 * `key` is the section name `issue_stories.section` uses, so answers compare directly with published issues.
 */

export interface SectionDraft {
  key: string;
  label: string;
  /** What belongs in the section, in plain words. The Decisions API reads this text. */
  definition: string;
  /** Automatic fill goes through the sections in this order, lowest first. */
  fillOrder: number;
  /** How many stories automatic fill pre-selects. Today's values of `section-config.ts`. Not a maximum. */
  fillCount: number;
}

export const SECTIONS: readonly SectionDraft[] = [
  {
    key: "headlines",
    label: "Top Stories",
    definition:
      "Major AI news that most readers must know today: a leading AI company ships or announces a new model, product or big capability; a big strategic move, partnership, acquisition or funding round; a government, regulator or court acts on AI; or a major controversy, leak or safety incident. Not a research paper. Not a small tool, library or feature update.",
    fillOrder: 1,
    fillCount: 3,
  },
  {
    key: "research_and_analysis",
    label: "Research & Analysis",
    definition:
      "A paper, benchmark, technical finding, dataset or research model is the main subject, from a lab, a university or a technical publication. Also a technical write-up that explains how a result was reached.",
    fillOrder: 2,
    fillCount: 4,
  },
  {
    key: "tools",
    label: "Tools",
    definition:
      "Something a reader can use today: a developer tool, library, API, SDK, open-source repo or app, or a new feature in an existing product. Smaller model releases and updates for builders belong here.",
    fillOrder: 3,
    fillCount: 3,
  },
  {
    key: "quick_hits",
    label: "Quick Hits",
    definition:
      "Any other real AI news that is worth one or two lines: company moves, partnerships, funding rounds, hires, policy and court news, smaller launches, and notable numbers or claims. Not a research paper and not a tool listing.",
    fillOrder: 4,
    fillCount: 6,
  },
];

export const NONE = "none";
const NONE_DESCRIPTION =
  "Not a story for the newsletter: opinion or an explainer with no news event, an ad or sponsor text, a job post, an event recap, a roundup of other stories, or not about AI.";

/** The levels of today's importance rubric (`EXTRACTION_IMPORTANCE_RUBRIC`), lowest first. Level index 0 is importance 1. */
export const IMPORTANCE_LEVELS: readonly { label: string; description: string }[] = [
  {
    label: "1",
    description: "Opinion, evergreen explainer, job move, minor integration, event recap, or no clear news event.",
  },
  {
    label: "2",
    description:
      "Incremental update or a new isolated feature in an existing product (any company), a minor model release, a small funding round, tooling from an unknown company, or an analysis piece with no news event.",
  },
  {
    label: "3",
    description:
      "A known AI-native company makes an announcement that has not shipped yet, a research paper with clear practical implications, funding of $50M to $500M, or a policy development with a named enforcement mechanism.",
  },
  {
    label: "4",
    description:
      "A Tier 1 company announces significant future plans for a new model, product or market, or ships a meaningful capability expansion (not a UI or isolated feature update). A well-known AI-native company (Cursor, Mistral, Perplexity, Cohere, Harvey, Hugging Face, Runway, ElevenLabs, Stability AI, Groq) ships something notable, or kills or pivots a significant product. Funding or an acquisition above $500M. A government action that affects one company. A notable public disagreement, leak or internal controversy at a major player.",
  },
  {
    label: "5",
    description:
      "A Tier 1 company ships a new standalone model or product line, or enters a new market category, today. A benchmark or event that resets the field's narrative. A Tier 1 company dramatically pivots a significant product or strategy. A government body takes formal AI action that affects a major company or the whole industry. A major safety incident, scandal or public controversy at a Tier 1 company.",
  },
];

export const DEVELOPER_MESSAGE =
  "You sort news stories for AI Recap, a weekday newsletter about AI news. The user message is one story. Judge only from its text.";

const IMPORTANCE_INSTRUCTIONS =
  "How newsworthy is this story within the AI industry? Tier 1 companies: OpenAI, Anthropic, Google/DeepMind, Meta AI, NVIDIA, Microsoft, Apple, Amazon/AWS, xAI.";

export type Question =
  | { type: "choice"; name: string; instructions: string; choices: { value: string; description: string }[] }
  | { type: "score"; name: string; instructions: string; levels: { label: string; description: string }[] }
  | { type: "predicate"; name: string; instructions: string };

/** The questions for one story: one `choice` over the sections, one `score` for importance, one `predicate` per section. */
export function buildQuestions(sections: readonly SectionDraft[] = SECTIONS): Question[] {
  return [
    {
      type: "choice",
      name: "section",
      instructions: "Which section of the newsletter does this story belong in?",
      choices: [
        ...sections.map((s) => ({ value: s.key, description: `${s.label}: ${s.definition}` })),
        { value: NONE, description: NONE_DESCRIPTION },
      ],
    },
    { type: "score", name: "importance", instructions: IMPORTANCE_INSTRUCTIONS, levels: [...IMPORTANCE_LEVELS] },
    ...sections.map(
      (s): Question => ({
        type: "predicate",
        name: `fits:${s.key}`,
        instructions: `Does this story belong in the "${s.label}" section of the newsletter? The section holds: ${s.definition}`,
      }),
    ),
  ];
}

/** The scoring version: a hash of the text the scorer reads. Scores are cached by it (`scores-<version>.json`). */
export function scoringVersion(sections: readonly SectionDraft[] = SECTIONS): string {
  return createHash("sha1")
    .update(JSON.stringify([DEVELOPER_MESSAGE, buildQuestions(sections)]))
    .digest("hex")
    .slice(0, 8);
}

/** What the test keeps for each story: the full distributions, so any formula can be tried later with no new calls. */
export interface StoryScores {
  /** Section key (or `none`) → probability, from the `choice` question. They sum to 1. */
  choice: Record<string, number>;
  /** Section key → probability, from that section's `predicate` question. Independent of each other. */
  fits: Record<string, number>;
  /** Importance 1 to 5 with decimals: the `score` answer (average level index) plus 1. */
  importance: number;
  /** Probability of each importance level, lowest first. */
  importanceLevels: number[];
}
