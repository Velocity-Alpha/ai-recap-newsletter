import { parseHTML } from "linkedom";

import { fetchText } from "@/src/pipeline/draft/articles/http";
import { htmlToText, markdownToText, type TextNodeLike } from "@/src/pipeline/draft/articles/text";
import { ADAPTER_MAX_BYTES, READER_USER_AGENT, type ArticleMethod, type MethodContext, type MethodText } from "@/src/pipeline/draft/articles/types";

/**
 * Method 1 (#115): some hosts have a cleaner source than the page the story links to.
 * - arXiv and Hugging Face papers: the arXiv HTML paper (the whole paper, not just the abstract). A Hugging Face
 *   paper id is its arXiv id, so no Hugging Face API call is needed.
 * - GitHub repos: the README through the REST API (repo pages often returned 504 in #115; the API never did).
 * - Hugging Face models: the model card's README.md.
 * A link with no adapter, or an adapter that fails, goes on to the page itself.
 */

export interface SiteAdapter {
  method: Extract<ArticleMethod, "arxiv" | "github" | "huggingface">;
  /** Where the adapter reads from. */
  source: string;
  read(context: MethodContext): Promise<MethodText>;
}

const ARXIV_ID = /^\d{4}\.\d{4,5}(v\d+)?$/;
const ARXIV_HOSTS = new Set(["arxiv.org", "www.arxiv.org", "export.arxiv.org"]);
const HF_HOSTS = new Set(["huggingface.co", "www.huggingface.co", "hf.co"]);
const GITHUB_HOSTS = new Set(["github.com", "www.github.com"]);

/** First path segments on github.com that are not user or org names. */
const GITHUB_RESERVED = new Set([
  "about", "apps", "blog", "collections", "contact", "customer-stories", "enterprise", "events", "explore", "features",
  "github-copilot", "login", "marketplace", "orgs", "pricing", "readme", "resources", "search", "security", "settings",
  "site", "solutions", "sponsors", "team", "topics", "trending",
]);
/** First path segments on huggingface.co that are not user or org names. */
const HF_RESERVED = new Set([
  "api", "blog", "changelog", "chat", "collections", "datasets", "docs", "enterprise", "huggingchat", "inference",
  "inference-endpoints", "join", "learn", "login", "models", "new", "notifications", "organizations", "papers", "posts",
  "pricing", "privacy", "search", "settings", "spaces", "tasks", "terms-of-service",
]);

const MARKDOWN_HEADERS = { "User-Agent": READER_USER_AGENT, Accept: "text/plain, text/markdown;q=0.9, */*;q=0.5" };

/** The arXiv paper's text: drops the references, appendices and contents list, and writes math as its TeX. */
export function arxivPaperText(html: string): string {
  const { document } = parseHTML(html);
  const paper = document.querySelector("article.ltx_document") ?? document.querySelector("article") ?? document.body;
  if (!paper) return "";
  for (const node of paper.querySelectorAll(".ltx_bibliography, .ltx_appendix, nav, .ltx_pagination, .ltx_page_navbar")) node.remove();
  for (const math of paper.querySelectorAll("math")) {
    math.replaceWith(document.createTextNode(` ${math.getAttribute("alttext") ?? ""} `));
  }
  return htmlToText(paper as unknown as TextNodeLike);
}

function arxivAdapter(id: string): SiteAdapter {
  const source = `https://arxiv.org/html/${id}`;
  return {
    method: "arxiv",
    source,
    async read(context) {
      const page = await fetchText(source, { ...context, headers: { "User-Agent": READER_USER_AGENT, Accept: "text/html" }, maxBytes: ADAPTER_MAX_BYTES });
      const text = page.status < 400 ? arxivPaperText(page.body) : "";
      return { text, httpStatus: page.status, finalUrl: page.url };
    },
  };
}

function markdownAdapter(method: SiteAdapter["method"], link: string, source: string, headers: Record<string, string>): SiteAdapter {
  return {
    method,
    source,
    async read(context) {
      const auth: Record<string, string> = method === "github" && context.githubToken ? { Authorization: `Bearer ${context.githubToken}` } : {};
      const file = await fetchText(source, { ...context, headers: { ...headers, ...auth }, maxBytes: ADAPTER_MAX_BYTES });
      // The story's link stays the final URL: the README is the repo or model page's own text.
      return { text: file.status < 400 ? markdownToText(file.body) : "", httpStatus: file.status, finalUrl: link };
    },
  };
}

export function matchSiteAdapter(link: string): SiteAdapter | null {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (ARXIV_HOSTS.has(host) && ["abs", "pdf", "html"].includes(parts[0]) && parts[1]) {
    const id = parts[1].replace(/\.pdf$/, "");
    return ARXIV_ID.test(id) ? arxivAdapter(id) : null;
  }
  if (HF_HOSTS.has(host) && parts[0] === "papers" && parts.length === 2) {
    return ARXIV_ID.test(parts[1]) ? arxivAdapter(parts[1]) : null;
  }
  if (GITHUB_HOSTS.has(host) && parts.length === 2 && !GITHUB_RESERVED.has(parts[0].toLowerCase())) {
    const [owner, repo] = [parts[0], parts[1].replace(/\.git$/, "")];
    const page = `https://github.com/${owner}/${repo}`;
    return markdownAdapter("github", page, `https://api.github.com/repos/${owner}/${repo}/readme`, {
      Accept: "application/vnd.github.raw+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": READER_USER_AGENT,
    });
  }
  if (HF_HOSTS.has(host) && parts.length === 2 && !HF_RESERVED.has(parts[0].toLowerCase())) {
    const page = `https://huggingface.co/${parts[0]}/${parts[1]}`;
    return markdownAdapter("huggingface", page, `${page}/resolve/main/README.md`, MARKDOWN_HEADERS);
  }
  return null;
}
