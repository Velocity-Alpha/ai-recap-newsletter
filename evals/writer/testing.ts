import type { WriterCase } from "@/evals/writer/dataset";
import type { ApprovedStory, WrittenIssueContent } from "@/src/pipeline/draft/content";

/** Made-up writer input and a draft that follows every rule, for the writer eval's tests. */

export const story = (id: number, note = ""): ApprovedStory => ({
  id,
  headline: `Headline ${id}`,
  summary: `Summary ${id}`,
  storyDetails: null,
  url: `https://example.com/${id}`,
  note,
});

export const CASE: WriterCase = {
  date: "2026-11-05",
  issueId: 1,
  sections: "issue_stories",
  input: {
    sections: { headlines: [story(1), story(2)], research: [story(3)], tools: [story(4)], quickHits: [story(5)] },
    leadStoryId: 1,
    articles: [{ storyId: 1, text: "Article one." }, { storyId: 2, unread: true }, { storyId: 3, text: "Article three." }],
  },
  articleSources: { "1": "saved", "2": "unread:blocked", "3": "read:fetch" },
};

export const bullet = (highlight: string) => ({ before: "The team", highlight, after: "this quarter." });
const feature = (id: number, headline: string, detail: string) => ({
  story_id: id,
  url: `https://example.com/${id}`,
  headline,
  story_detail: detail,
  bullets: [bullet("cut latency by 40%"), bullet("hired 12 researchers"), bullet("opened a Paris office")],
});

export const GOOD: WrittenIssueContent = {
  title: "Lab ships faster reasoning model",
  excerpt: "A lab ships a faster model. Rivals respond.",
  overview: {
    summary:
      "Good morning, a lab shipped a faster reasoning model and rivals are scrambling to answer it with their own launches. " +
      "Researchers also found a cheaper way to train small models, and a new tool makes agents easier to test before release, which could save teams real time this week. " +
      "Let's dive in.",
  },
  headlines: [
    feature(1, "Lab ships a faster model", "The lab shipped a model. It is faster than before."),
    feature(2, "Rival answers back", "A rival answered. It priced lower."),
  ],
  research_and_analysis: [feature(3, "Can small models learn cheaply?", "Researchers trained small models. Costs fell.")],
  tools: [{ story_id: 4, url: "https://example.com/4", link_text: "AgentTest", detail: "tests agents before release." }],
  quick_hits: [{ story_id: 5, url: "https://example.com/5", link_text: "Chip maker", text: "raises a new round." }],
};
