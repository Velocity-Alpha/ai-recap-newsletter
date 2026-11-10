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
  /\b(openai|chatgpt|gpt|anthropic|claude|google|deepmind|gemini|meta|llama|xai|grok|microsoft|copilot|nvidia|apple|amazon|aws|deepseek|mistral|kimi|moonshot|qwen|alibaba|z\.ai|zhipu|glm|minimax|tencent|hunyuan)\b/i;
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

/** Every selected story that can lead, best score first; ties keep board order, Top Stories first. */
function rankLeadCandidates<S extends LeadCandidate>(
  sections: readonly { key: string; selected: readonly S[] }[]
): { story: S; sectionKey: string; score: number }[] {
  const ordered = [
    ...sections.filter((section) => section.key === LEAD_SECTION),
    ...sections.filter((section) => section.key !== LEAD_SECTION),
  ];
  const ranked = ordered.flatMap((section) =>
    section.selected
      .filter((story) => canLead(story, section.key))
      .map((story) => ({ story, sectionKey: section.key, score: leadScore(story) }))
  );
  // Array.prototype.sort is stable, so equal scores keep board order.
  return ranked.sort((a, b) => b.score - a.score);
}

/** The selected story the board pre-sets as the lead, and the section it sits in, or null when none can lead. */
export function proposeLeadStory(sections: readonly LeadSection[]): ProposedLead | null {
  const [best] = rankLeadCandidates(sections);
  return best ? { id: best.story.id, sectionKey: best.sectionKey } : null;
}

type SectionOption = { id: number; headline: string; summary: string };
type BoardSection = { key: string; max: number; selected: SectionOption[]; fill_ins: SectionOption[] };
type BoardEntry = LeadCandidate & { summary: string | null };
type LeadBoard = {
  candidate_sections: BoardSection[];
  candidate_map: Record<string, BoardEntry>;
  selected_story_ids: number[];
  proposed_lead_id?: number | null;
  proposed_lead_reason?: string | null;
};

/**
 * Puts a lead from another section at the top of Top Stories, as the owner does by hand. The section it leaves
 * promotes its first fill-in, and the last Top Story becomes the first Top Story fill-in. Returns new sections.
 */
export function moveLeadToTopStories<T extends BoardSection>(sections: T[], lead: ProposedLead | null): T[] {
  const copy = sections.map((section) => ({ ...section, selected: [...section.selected], fill_ins: [...section.fill_ins] }));
  const topStories = copy.find((section) => section.key === LEAD_SECTION);
  const from = copy.find((section) => section.key === lead?.sectionKey);
  if (!lead || !topStories || !from || from === topStories) return sections;
  const story = from.selected.find((option) => option.id === lead.id);
  if (!story) return sections;

  from.selected = from.selected.filter((option) => option.id !== lead.id);
  const promoted = from.fill_ins.shift();
  if (promoted) from.selected.push(promoted);

  topStories.selected = [story, ...topStories.selected];
  if (topStories.selected.length > topStories.max) {
    topStories.fill_ins = [...topStories.selected.splice(topStories.max), ...topStories.fill_ins];
  }
  return copy;
}

export type LeadShortlistEntry = {
  id: number;
  headline: string;
  summary: string;
  section: string;
  sources: number;
  score: number;
};

/** The stories the AI lead pick chooses from: the selected stories that can lead, best score first. */
export function leadShortlist(board: LeadBoard, limit: number): LeadShortlistEntry[] {
  const sections = board.candidate_sections.map((section) => ({
    key: section.key,
    selected: section.selected.flatMap((option) => board.candidate_map[String(option.id)] ?? []),
  }));
  return rankLeadCandidates(sections)
    .slice(0, limit)
    .map(({ story, sectionKey, score }) => ({
      id: story.id,
      headline: story.headline ?? "",
      summary: story.summary ?? "",
      section: sectionKey,
      sources: storySources(story).length,
      score,
    }));
}

/** The number of stories the AI lead pick sees. */
export const LEAD_SHORTLIST_SIZE = 8;

/**
 * Applies the AI's lead pick to a built board: the picked story becomes the proposed lead, with the AI's reason,
 * at the top of Top Stories. A pick that is not on the board's shortlist is ignored (the board is returned as is).
 */
export function applyLeadPick<T extends LeadBoard>(board: T, pick: { leadId: number; reason: string }): T {
  const onShortlist = leadShortlist(board, LEAD_SHORTLIST_SIZE).some((entry) => entry.id === pick.leadId);
  if (!onShortlist) return board;
  const sectionKey = board.candidate_sections.find((section) =>
    section.selected.some((option) => option.id === pick.leadId)
  )?.key;
  if (!sectionKey) return board;

  const candidate_sections = moveLeadToTopStories(board.candidate_sections, { id: pick.leadId, sectionKey });
  return {
    ...board,
    candidate_sections,
    selected_story_ids: candidate_sections.flatMap((section) => section.selected.map((option) => option.id)),
    proposed_lead_id: pick.leadId,
    proposed_lead_reason: pick.reason,
  };
}
