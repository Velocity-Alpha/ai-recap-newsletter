import { CANDIDATE_SECTION_CONFIGS, type SectionKey } from "@/src/features/newsletter/section-config";
import {
  CONTENT_SECTION_KEYS,
  FEATURE_BULLET_COUNT,
  type ApprovedSections,
  type ApprovedStory,
  type ContentSectionKey,
  type FeatureStory,
  type WrittenIssueContent,
} from "@/src/pipeline/draft/content";

/**
 * Code checks on the writer's output. Each problem is one plain sentence; an empty list means the content
 * can go into the email.
 */

const TITLE_WORDS = { min: 4, max: 8 };
const OVERVIEW_WORDS = { min: 45, max: 80 };

const SECTION_KEYS = CANDIDATE_SECTION_CONFIGS.map((config) => config.key);
const SECTION_LABELS = Object.fromEntries(
  CANDIDATE_SECTION_CONFIGS.map((config) => [CONTENT_SECTION_KEYS[config.key], config.label])
) as Record<ContentSectionKey, string>;

// Links, HTML tags, and markdown links, bold, or code: none belong in plain-text fields.
/** A link, an HTML tag, a markdown link, bold or code: plain-text fields must have none. */
export const MARKUP = /https?:\/\/|\bwww\.|<\/?[a-z][^>]*>|\]\(|\*\*|`/i;

export function countWords(text: string): number {
  return text.split(/\s+/).filter((word) => /[\p{L}\p{N}]/u.test(word)).length;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function wordCountProblem(label: string, text: string, range: { min: number; max: number }): string | null {
  const count = countWords(text);
  if (count >= range.min && count <= range.max) return null;
  return `${label} has ${plural(count, "word")}; it needs ${range.min} to ${range.max}`;
}

interface ItemView {
  story_id: number;
  url: string;
  /** The text the website needs to show the item at all. */
  required: { name: string; value: string };
  fields: Array<[string, string]>;
  bullets?: FeatureStory["bullets"];
}

function itemsOf(content: WrittenIssueContent, key: ContentSectionKey): ItemView[] {
  if (key === "headlines" || key === "research_and_analysis") {
    return content[key].map((story) => ({
      story_id: story.story_id,
      url: story.url,
      required: { name: "headline", value: story.headline },
      fields: [
        ["headline", story.headline],
        ["story_detail", story.story_detail],
        ...story.bullets.map(
          (bullet, index): [string, string] => [`bullet ${index + 1}`, `${bullet.before} ${bullet.highlight} ${bullet.after}`]
        ),
      ],
      bullets: story.bullets,
    }));
  }
  if (key === "tools") {
    return content.tools.map((tool) => ({
      story_id: tool.story_id,
      url: tool.url,
      required: { name: "link text", value: tool.link_text },
      fields: [
        ["link_text", tool.link_text],
        ["detail", tool.detail],
      ],
    }));
  }
  return content.quick_hits.map((hit) => ({
    story_id: hit.story_id,
    url: hit.url,
    required: { name: "link text", value: hit.link_text },
    fields: [
      ["link_text", hit.link_text],
      ["text", hit.text],
    ],
  }));
}

export function findContentProblems(content: WrittenIssueContent, approved: ApprovedSections): string[] {
  const problems: string[] = [];
  const add = (problem: string) => problems.push(problem);

  const titleProblem = wordCountProblem("The title", content.title, TITLE_WORDS);
  if (titleProblem) add(`${titleProblem}: "${content.title}".`);
  if (MARKUP.test(content.title)) add("The title contains a link or markup; text must be plain.");
  if (!content.excerpt.trim()) add("The excerpt is empty.");
  if (MARKUP.test(content.excerpt)) add("The excerpt contains a link or markup; text must be plain.");
  const overviewProblem = wordCountProblem("The overview", content.overview.summary, OVERVIEW_WORDS);
  if (overviewProblem) add(`${overviewProblem}.`);
  if (MARKUP.test(content.overview.summary)) add("The overview contains a link or markup; text must be plain.");

  const approvedById = new Map<number, { story: ApprovedStory; section: ContentSectionKey }>();
  for (const key of SECTION_KEYS) {
    for (const story of approved[key as SectionKey]) {
      approvedById.set(story.id, { story, section: CONTENT_SECTION_KEYS[key] });
    }
  }
  const approvedUrls = new Set([...approvedById.values()].map(({ story }) => story.url.trim()));
  const seen = new Map<number, number>();

  for (const key of SECTION_KEYS) {
    const contentKey = CONTENT_SECTION_KEYS[key];
    itemsOf(content, contentKey).forEach((item, index) => {
      const name = `Story ${item.story_id}`;
      const match = approvedById.get(item.story_id);

      if (!match) {
        const where = `${SECTION_LABELS[contentKey]} item ${index + 1}`;
        add(`${where} has story_id ${item.story_id}, which is not an approved story.`);
        if (!approvedUrls.has(item.url.trim())) add(`${where} links to "${item.url}", which is not an approved link.`);
      } else {
        seen.set(item.story_id, (seen.get(item.story_id) ?? 0) + 1);
        if (match.section !== contentKey) {
          add(`${name} is in ${SECTION_LABELS[contentKey]} but was approved for ${SECTION_LABELS[match.section]}.`);
        }
        if (item.url.trim() !== match.story.url.trim()) {
          add(`${name} links to "${item.url}", not its approved link "${match.story.url}".`);
        }
      }

      if (!item.required.value.trim()) add(`${name} has no ${item.required.name}.`);
      if (item.bullets) {
        if (item.bullets.length !== FEATURE_BULLET_COUNT) {
          add(`${name} has ${plural(item.bullets.length, "bullet")}; feature stories need exactly ${FEATURE_BULLET_COUNT}.`);
        }
        item.bullets.forEach((bullet, bulletIndex) => {
          if (!bullet.highlight.trim()) add(`${name} bullet ${bulletIndex + 1} has no highlighted phrase.`);
        });
      }
      for (const [field, value] of item.fields) {
        if (MARKUP.test(value)) add(`${name} ${field} contains a link or markup; text must be plain.`);
      }
    });
  }

  for (const [id, { section }] of approvedById) {
    const count = seen.get(id) ?? 0;
    if (count === 0) add(`Story ${id} (${SECTION_LABELS[section]}) is missing.`);
    if (count > 1) add(`Story ${id} appears ${count} times; it must appear once.`);
  }

  return problems;
}

/** Throws one error listing every problem, so a failed draft shows exactly what to fix. */
export function assertValidContent(content: WrittenIssueContent, approved: ApprovedSections): void {
  const problems = findContentProblems(content, approved);
  if (problems.length === 0) return;
  throw new Error(`The written issue failed ${plural(problems.length, "check")}: ${problems.join(" | ")}`);
}
