/**
 * Test helper: a made-up outline and the written content that matches it. Placeholder text only.
 */
import type { ApprovedSections, WrittenIssueContent } from "@/src/pipeline/draft/content";

export const SAMPLE_APPROVED: ApprovedSections = {
  headlines: [
    {
      id: 501,
      headline: "Example Lab Ships Pretend Planner Model",
      summary: "A fictional lab released a made-up model that plans imaginary errands.",
      storyDetails: "The pretend model plans a week of fictional errands in one pass.",
      url: "https://news.example.test/planner?ref=feed&id=1",
      note: "",
    },
    {
      id: 502,
      headline: "Sample Robot Folds Imaginary Laundry",
      summary: "A sample robot folded placeholder towels faster than before.",
      storyDetails: null,
      url: "https://robots.example.test/laundry",
      note: "Keep this one light.",
    },
  ],
  research: [
    {
      id: 503,
      headline: "Placeholder Study Measures Toy Benchmarks",
      summary: "A placeholder study compares toy benchmarks across pretend models.",
      storyDetails: "The study covers twelve toy tasks.",
      url: "https://papers.example.test/abs/0001",
      note: "",
    },
    {
      id: 504,
      headline: "Synthetic Survey Of Fake Agents",
      summary: "A synthetic survey lists how fake agents fail.",
      storyDetails: null,
      url: "https://papers.example.test/abs/0002",
      note: "",
    },
  ],
  tools: [
    {
      id: 505,
      headline: "Test Toolkit 2.0",
      summary: "A test toolkit makes placeholder builds faster.",
      storyDetails: null,
      url: "https://tools.example.test/toolkit",
      note: "",
    },
    {
      id: 506,
      headline: "Mock Editor Plugin",
      summary: "A mock plugin adds pretend autocomplete.",
      storyDetails: null,
      url: "https://tools.example.test/plugin",
      note: "",
    },
  ],
  quickHits: [
    {
      id: 507,
      headline: "Fictional Startup Raises Pretend Round",
      summary: "A fictional startup raised a pretend round.",
      storyDetails: null,
      url: "https://hits.example.test/round",
      note: "",
    },
    {
      id: 508,
      headline: "Imaginary Agency Drafts Sample Rules",
      summary: "An imaginary agency drafted sample rules for toy models.",
      storyDetails: null,
      url: "https://hits.example.test/rules",
      note: "",
    },
  ],
};

function bullets(prefix: string) {
  return [
    { before: `${prefix} first point covers`, highlight: "a made-up number", after: "for the test." },
    { before: `${prefix} second point notes`, highlight: "a pretend detail", after: ", then stops." },
    { before: "", highlight: `${prefix} third highlight`, after: "starts the line." },
  ];
}

export const SAMPLE_CONTENT: WrittenIssueContent = {
  title: "Pretend Lab Teaches Models To Plan",
  excerpt: "A pretend lab ships a planner model, and a sample robot folds imaginary laundry.",
  overview: {
    summary:
      "Good morning, a made-up lab says its pretend model can now plan a whole week of fictional errands, " +
      "and a sample robot learned to fold imaginary laundry in record time. Meanwhile, a test toolkit " +
      "promises faster placeholder builds for everyone who writes sample code. Let's dive in.",
  },
  headlines: [
    {
      story_id: 501,
      url: "https://news.example.test/planner?ref=feed&id=1",
      headline: "Example Lab Ships a Pretend Planner",
      story_detail: "The fictional lab released a model that plans imaginary errands. It works in one pass & stays offline.",
      bullets: bullets("Planner"),
    },
    {
      story_id: 502,
      url: "https://robots.example.test/laundry",
      headline: "A Sample Robot Folds Faster",
      story_detail: "A sample robot folded placeholder towels in record time.",
      bullets: bullets("Robot"),
    },
  ],
  research_and_analysis: [
    {
      story_id: 503,
      url: "https://papers.example.test/abs/0001",
      headline: "Toy Benchmarks Get a Placeholder Study",
      story_detail: "A placeholder study compares twelve toy tasks across pretend models.",
      bullets: bullets("Study"),
    },
    {
      story_id: 504,
      url: "https://papers.example.test/abs/0002",
      headline: "How Fake Agents Fail",
      story_detail: "A synthetic survey sorts the ways fake agents fail.",
      bullets: bullets("Survey"),
    },
  ],
  tools: [
    { story_id: 505, url: "https://tools.example.test/toolkit", link_text: "Test Toolkit 2.0", detail: "makes placeholder builds faster." },
    { story_id: 506, url: "https://tools.example.test/plugin", link_text: "Mock Editor Plugin", detail: "adds pretend autocomplete - quietly." },
  ],
  quick_hits: [
    { story_id: 507, url: "https://hits.example.test/round", link_text: "A fictional startup", text: "raised a pretend round." },
    { story_id: 508, url: "https://hits.example.test/rules", link_text: "An imaginary agency", text: "drafted sample rules for toy models." },
  ],
};

export const SAMPLE_ISSUE = { id: 301, issueDate: "2027-01-04" };

export const SAMPLE_DRAFT = { id: 41, featuredImageUrl: "https://assets.example.test/newsletter/2027-01-04-abc.jpg" };
