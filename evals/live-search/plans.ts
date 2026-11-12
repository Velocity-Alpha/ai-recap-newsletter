/**
 * First-draft search plans for live search sources (#86). These are the parts to tune with the owner.
 * They are built from the extraction rules (src/pipeline/ingest/extract.ts): the same categories and the same
 * company tiers as the importance rubric, so a search asks for what the rubric scores high.
 */

/** Tier 1 companies of the importance rubric. */
export const TIER_1 = ["OpenAI", "Anthropic", "Google DeepMind", "Meta AI", "NVIDIA", "Microsoft", "Apple", "Amazon AWS", "xAI"];

/** AI-native companies the rubric names at level 4. */
export const AI_NATIVE = ["Cursor", "Mistral", "Perplexity", "Cohere", "Harvey", "Hugging Face", "Runway", "ElevenLabs", "Stability AI", "Groq"];

/**
 * Domains whose pages are other newsletters, roundups or aggregators. A search result from one of them is a copy
 * of the news, not the news: our own sources already bring these, and they make a backtest look better than a
 * 05:00 ET run could be.
 */
export const EXCLUDED_DOMAINS = [
  "therundown.ai",
  "aibreakfast.beehiiv.com",
  "thesignal.substack.com",
  "tldr.tech",
  "alphasignal.ai",
  "intheworldofai.com",
  "bensbites.com",
  "superhuman.ai",
  "news.smol.ai",
  "lastweekin.ai",
  "aidaily.media",
  "cerros.ai",
  "malpass.co",
  "originbrief.app",
  "opendatascience.com",
  "news.supwil.com",
  "tech.yahoo.com",
];

/** Exa: one semantic query per rubric area. Each runs with category "news" and the time window. */
export const EXA_QUERIES: { key: string; query: string }[] = [
  { key: "launches", query: "AI company launches new model or product, available today" },
  { key: "openai", query: "OpenAI announces" },
  { key: "anthropic", query: "Anthropic announces Claude" },
  { key: "google", query: "Google DeepMind Gemini announcement" },
  { key: "big-tech", query: "Meta, NVIDIA, Microsoft, Apple or Amazon AI announcement" },
  { key: "ai-native", query: `AI startup ships new product: ${AI_NATIVE.join(", ")}` },
  { key: "funding", query: "AI startup raises funding round or acquisition" },
  { key: "policy", query: "government, regulator or court takes action on AI" },
  { key: "tools", query: "new AI developer tool, API or open-source model release" },
  { key: "research", query: "new AI research paper or benchmark result from a lab" },
];

/**
 * Exa first-party and top publishers. Picked from the links of published stories since 2026-08-01 (720 stories,
 * 164 headlines or leads): company pages carry about a third of the headlines, and a few publishers most of the
 * rest. No "news" category for company pages (it leaves them out). Managed Exa (Composio) returns at most 10
 * results a call, so each group is its own call.
 */
export const EXA_DOMAIN_PLANS: { key: string; query: string; domains: string[]; news: boolean }[] = [
  { key: "1p-openai", query: "OpenAI announcement", domains: ["openai.com", "developers.openai.com"], news: false },
  { key: "1p-anthropic", query: "Anthropic Claude announcement", domains: ["anthropic.com", "claude.com"], news: false },
  {
    key: "1p-google",
    query: "Google AI announcement",
    domains: ["blog.google", "deepmind.google", "research.google", "cloud.google.com", "developers.googleblog.com"],
    news: false,
  },
  {
    key: "1p-others",
    query: "new AI model, product or feature announcement",
    domains: [
      "about.fb.com",
      "ai.meta.com",
      "x.ai",
      "blogs.microsoft.com",
      "nvidianews.nvidia.com",
      "blogs.nvidia.com",
      "apple.com",
      "aboutamazon.com",
      "mistral.ai",
      "cursor.com",
      "perplexity.ai",
      "elevenlabs.io",
      "cohere.com",
      "runwayml.com",
      "deepseek.com",
    ],
    news: false,
  },
  {
    key: "pub-launches",
    query: "AI company launches or releases",
    domains: ["techcrunch.com", "testingcatalog.com", "venturebeat.com", "theverge.com", "thenextweb.com"],
    news: true,
  },
  {
    key: "pub-business",
    query: "AI deal, funding, lawsuit or government action",
    domains: ["cnbc.com", "fortune.com", "reuters.com", "bloomberg.com", "techcrunch.com"],
    news: true,
  },
];

/** Perplexity Sonar: a few focused asks. The model runs its own searches inside the date filter. */
export const SONAR_FOCUSES: { key: string; focus: string }[] = [
  {
    key: "frontier",
    focus: `launches, model releases, strategy moves and controversies from ${TIER_1.join(", ")}`,
  },
  {
    key: "startups-tools",
    focus: `product launches and developer tools from AI startups such as ${AI_NATIVE.join(", ")}, and notable open-source model releases`,
  },
  {
    key: "money-policy-research",
    focus: "AI funding rounds over $50M, acquisitions, government or court actions on AI, and research papers or benchmarks from major labs",
  },
];

export function sonarPrompt(focus: string, fromDate: string, toDate: string): string {
  return `You find AI industry news for a daily newsletter. List the most newsworthy stories published between ${fromDate} and ${toDate} about: ${focus}.

Rules:
- Only real news events: a launch, release, funding, acquisition, policy or court action, research result, or a named company's strategic move.
- No opinion pieces, explainers, listicles, or stories about AI taking jobs.
- The url must be the original article or announcement page (the company's own post, or the publisher's article). Never a newsletter, a roundup, a "top AI stories" page, a date archive, or a tag page.
- One entry per news event. Up to 12 entries, most important first.`;
}

export const SONAR_SCHEMA = {
  type: "object",
  properties: {
    stories: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          url: { type: "string" },
          published_date: { type: "string", description: "YYYY-MM-DD" },
        },
        required: ["headline", "url", "published_date"],
        additionalProperties: false,
      },
    },
  },
  required: ["stories"],
  additionalProperties: false,
};

/** Grok x_search: up to 20 handles (the API's limit). Lab and founder accounts that post first-party news. */
export const GROK_HANDLES = [
  "OpenAI",
  "OpenAIDevs",
  "AnthropicAI",
  "claudeai",
  "GoogleDeepMind",
  "GoogleAI",
  "geminiapp",
  "xai",
  "AIatMeta",
  "nvidia",
  "MistralAI",
  "huggingface",
  "perplexity_ai",
  "cursor_ai",
  "deepseek_ai",
  "Alibaba_Qwen",
  "sama",
  "demishassabis",
  "karpathy",
  "ElevenLabsio",
];

export function grokPrompt(fromDate: string, toDate: string): string {
  return `Search X for AI announcements posted from ${fromDate} up to (not including) ${toDate} by the allowed accounts.
List every real announcement: a launch, model release, new feature that is live, research result, funding, partnership, or policy news. Skip replies, jokes, hiring posts, event promos and reposts of old news.
Return one line per announcement, most important first, at most 15 lines, in this exact format:
headline | post URL | linked article URL or "-" | YYYY-MM-DD`;
}

/** Hacker News: a free cross-check. Stories in the window with at least this many points, AI words in the title. */
export const HN_MIN_POINTS = 40;
export const HN_AI_WORDS =
  /\b(ai|llm|llms|gpt|openai|anthropic|claude|gemini|deepmind|llama|mistral|nvidia|model|models|agent|agents|copilot|chatgpt|grok|xai|deepseek|qwen|transformer|inference|diffusion)\b/i;
