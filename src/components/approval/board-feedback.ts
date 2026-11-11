/**
 * The parts of the commit body that record how the owner changed the **proposed board** (#150): `proposed` and
 * `feedback`. The server works out the board actions from them (src/pipeline/feedback/board-diff.ts).
 */

type StoryRef = { id: number };

type BuiltSection = { key: string; selected: StoryRef[] };

type BoardSection = { key: string; stories: { story: StoryRef }[] };

/** A reason the owner gave on the board: a tapped code and a free text, both optional. */
export type GivenReason = { code: string; text: string };

export type ProposedSection = { key: string; story_ids: number[] };

export type ProposedBody = { sections: ProposedSection[]; lead_story_id: number | null; repeats_removed: number[] };

export type FeedbackEntry = { story_id: number | null; action: "lead" | "move"; code: string; text: string };

/** The selected stories of each section, in order, as the board built them. */
export function proposedSectionsOf(candidateSections: BuiltSection[]): ProposedSection[] {
  return candidateSections.map((section) => ({ key: section.key, story_ids: section.selected.map((story) => story.id) }));
}

export function proposedBody(sections: ProposedSection[], leadStoryId: number | null, repeatsRemoved: number[]): ProposedBody {
  return { sections, lead_story_id: leadStoryId, repeats_removed: repeatsRemoved };
}

/** The section a story was proposed in, or null when the board did not propose it. */
export function proposedSectionOf(proposed: ProposedSection[], storyId: number): string | null {
  return proposed.find((section) => section.story_ids.includes(storyId))?.key ?? null;
}

/** True when the story is now in another section than the one it was proposed in. */
export function isMoved(proposed: ProposedSection[], storyId: number, sectionKey: string): boolean {
  const from = proposedSectionOf(proposed, storyId);
  return from !== null && from !== sectionKey;
}

function given(reason: GivenReason | undefined): GivenReason | null {
  const code = reason?.code.trim() ?? "";
  const text = reason?.text.trim() ?? "";
  return code || text ? { code, text } : null;
}

/**
 * The reasons for the differences that exist at commit: the lead, when it is not the proposed lead, and each story
 * that is now in another section. A reason with no tap and no text is not sent.
 */
export function feedbackBody(board: {
  proposed: ProposedSection[];
  sections: BoardSection[];
  headlineStoryId: number | null;
  proposedLeadId: number | null;
  leadReasons: Record<number, GivenReason>;
  moveReasons: Record<number, GivenReason>;
}): FeedbackEntry[] {
  const entries: FeedbackEntry[] = [];
  const lead = board.headlineStoryId;
  const leadReason = lead !== null && lead !== board.proposedLeadId ? given(board.leadReasons[lead]) : null;
  if (leadReason) entries.push({ story_id: lead, action: "lead", ...leadReason });
  for (const section of board.sections) {
    for (const { story } of section.stories) {
      const reason = isMoved(board.proposed, story.id, section.key) ? given(board.moveReasons[story.id]) : null;
      if (reason) entries.push({ story_id: story.id, action: "move", ...reason });
    }
  }
  return entries;
}
