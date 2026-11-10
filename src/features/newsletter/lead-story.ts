/**
 * The board's proposed lead story (#58).
 *
 * The owner's test for a lead: what will people interested in AI be talking about today? A big release from a
 * major lab, a major product update, an IPO or giant round, a policy that changes the direction of AI. Less doom
 * and gloom when possible. A story several newsletters covered is a sign of a good story. Never a repeat (the
 * duplicate check removes those before this runs). Research leads only when it is groundbreaking.
 *
 * Lead score = importance score
 *   + 1 per extra newsletter that covered the story
 *   + 1 when the headline names a major lab, + 1 more when it is a model launch from one
 *   + 1 for an IPO or a round of $100M or more
 *   - 1 for doom and gloom (breaches, exploits, lawsuits, layoffs)
 *
 * Who can lead: any selected story, except
 * - research, unless 2+ newsletters covered it (the stand-in for "groundbreaking");
 * - a Hugging Face paper or Product Hunt launch that no newsletter picked up;
 * - a paywalled link (the board cannot yet offer a free alternative, #59).
 * Ties keep board order, Top Stories first.
 */

type CoverageFields = { source: string | null; sources?: readonly string[] };
type LeadCandidate = CoverageFields & {
  id: number;
  headline: string | null;
  importance_score: number | null;
  paywall_detected?: "yes" | "no" | "unknown" | "error";
};
type LeadSection = { key: string; selected: readonly LeadCandidate[] };

export type ProposedLead = { id: number; sectionKey: string };

const LEAD_SECTION = "headlines";
const RESEARCH_SECTION = "research";
const FEED_SOURCES = new Set(["huggingface", "product_hunt_ai"]);

const MAJOR_LAB =
  /\b(openai|chatgpt|gpt|anthropic|claude|google|deepmind|gemini|meta|llama|xai|grok|microsoft|copilot|nvidia|apple|amazon|aws|deepseek|mistral|kimi|moonshot|qwen|alibaba)\b/i;
const LAUNCH = /\b(launch(es|ed)?|release[sd]?|ships?|introduc(es|ed)|unveil(s|ed)?|debuts?|open-sources?|rolls? out)\b/i;
const MODEL = /\b(models?|gpt-\S+|gemini \d|claude \S+|llama \d|weights|open-weight|genie|lfm\d|large \d)\b/i;
const BIG_MONEY = /\bipo\b|go(es|ing)? public|\$\d+(\.\d+)?\s?(b|billion)\b|\$[1-9]\d{2,}\s?(m|million)\b/i;
const DOOM =
  /\b(compromised|vulnerabilit\w*|exploits?|malware|lawsuits?|sues|layoffs?|misalign\w*|attacks?|breach\w*|hack\w*|warns?|danger\w*)\b/i;

/** The distinct newsletters that covered a story: its stored mentions plus the row's own source. */
export function storySources(story: CoverageFields): string[] {
  const all = [...(story.sources ?? []), ...(story.source ? [story.source] : [])];
  return Array.from(new Set(all)).sort();
}

export function leadScore(story: LeadCandidate): number {
  const headline = story.headline ?? "";
  const lab = MAJOR_LAB.test(headline);
  let score = Number(story.importance_score ?? 0) + Math.max(0, storySources(story).length - 1);
  if (lab) score += 1;
  if (lab && LAUNCH.test(headline) && MODEL.test(headline)) score += 1;
  if (BIG_MONEY.test(headline)) score += 1;
  if (DOOM.test(headline)) score -= 1;
  return score;
}

function canLead(story: LeadCandidate, sectionKey: string): boolean {
  if (story.paywall_detected === "yes") return false;
  const sources = storySources(story);
  const covered = sources.length >= 2;
  if (!covered && sources.every((source) => FEED_SOURCES.has(source))) return false;
  if (sectionKey === RESEARCH_SECTION && !covered) return false;
  return true;
}

/** The selected story the board pre-sets as the lead, and the section it sits in, or null when none can lead. */
export function proposeLeadStory(sections: readonly LeadSection[]): ProposedLead | null {
  const ordered = [
    ...sections.filter((section) => section.key === LEAD_SECTION),
    ...sections.filter((section) => section.key !== LEAD_SECTION),
  ];

  let best: (ProposedLead & { score: number }) | null = null;
  for (const section of ordered) {
    for (const story of section.selected) {
      if (!canLead(story, section.key)) continue;
      const score = leadScore(story);
      if (best === null || score > best.score) best = { id: story.id, sectionKey: section.key, score };
    }
  }
  return best ? { id: best.id, sectionKey: best.sectionKey } : null;
}
