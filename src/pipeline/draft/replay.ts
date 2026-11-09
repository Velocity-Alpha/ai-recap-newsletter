import type { ApprovedSections, WrittenIssueContent } from "@/src/pipeline/draft/content";
import { renderIssueEmailHtml } from "@/src/pipeline/draft/email-html";
import { createDraftTemplate } from "@/src/pipeline/draft/ghl-template";
import { normalizeOutline, type ApprovalOutline } from "@/src/pipeline/draft/outline";
import { DRAFT_STEPS, DraftStepError, produceDraft, readNoArticles, type DraftStep, type ReadArticles } from "@/src/pipeline/draft/produce-draft";
import { findContentProblems } from "@/src/pipeline/draft/validate";
import { createOpenAIIssueWriter, type IssueWriter } from "@/src/pipeline/draft/writer";
import { parseCommitDate } from "@/src/pipeline/side-effects/commit-webhook";

/**
 * The pieces of scripts/replay-drafts.mts that need no database or network: replay one past commit through
 * produceDraft with n8n's image and a GHL dry run, and lay the two emails side by side (#76 testing box).
 */

export const REPLAY_USAGE = `Usage: npx vite-node --config vitest.config.ts scripts/replay-drafts.mts -- \\
  --out <dir> --commit <commit.json> --reuse-image-from <n8n-issue.json> [--commit ... --reuse-image-from ...]`;

export interface ReplayArgs {
  out: string;
  pairs: Array<{ commit: string; issue: string }>;
}

export function parseReplayArgs(argv: string[]): ReplayArgs {
  let out = "";
  const pairs: Array<{ commit: string; issue: string }> = [];
  const args = argv.filter((arg) => arg !== "--");
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag !== "--out" && flag !== "--commit" && flag !== "--reuse-image-from") {
      throw new Error(`Unknown argument "${flag}".\n${REPLAY_USAGE}`);
    }
    if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value.\n${REPLAY_USAGE}`);
    index += 1;
    if (flag === "--out") out = value;
    if (flag === "--commit") pairs.push({ commit: value, issue: "" });
    if (flag === "--reuse-image-from") {
      const last = pairs.at(-1);
      if (!last || last.issue) throw new Error(`--reuse-image-from must follow a --commit.\n${REPLAY_USAGE}`);
      last.issue = value;
    }
  }
  if (!out) throw new Error(`Missing --out.\n${REPLAY_USAGE}`);
  if (pairs.length === 0) throw new Error(`Give at least one --commit.\n${REPLAY_USAGE}`);
  const unpaired = pairs.find((pair) => !pair.issue);
  if (unpaired) throw new Error(`${unpaired.commit} has no --reuse-image-from <n8n-issue.json>.\n${REPLAY_USAGE}`);
  return { out, pairs };
}

type Json = Record<string, unknown>;

function unwrap(value: unknown, what: string): Json {
  const item = Array.isArray(value) && value.length === 1 ? value[0] : value;
  if (!item || typeof item !== "object" || Array.isArray(item)) throw new Error(`${what} must be one JSON object.`);
  return item as Json;
}

/** The board's commit body (as POSTed to /api/newsletters/commit) as an outline. */
export function commitOutline(body: unknown, fallbackDate?: string): ApprovalOutline {
  const payload = unwrap(body, "The commit body");
  const date = parseCommitDate(payload.date) ?? (fallbackDate ? parseCommitDate(fallbackDate) : null);
  if (!date) throw new Error("The commit body has no valid date.");
  return normalizeOutline(payload, date);
}

export interface N8nIssue {
  id: number;
  /** YYYY-MM-DD */
  date: string;
  title: string;
  html: string;
  featuredImageUrl: string;
  scenePrompt: string;
}

/** An n8n `newsletter.issues` row, exported as JSON (snake_case from SQL, or camelCase from Prisma). */
export function readN8nIssue(value: unknown): N8nIssue {
  const row = unwrap(value, "The n8n issue");
  const text = (...keys: string[]) => {
    for (const key of keys) if (typeof row[key] === "string" && (row[key] as string).trim()) return (row[key] as string).trim();
    throw new Error(`The n8n issue has no ${keys[0]}.`);
  };
  const id = Number(row.id);
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error("The n8n issue has no id.");
  return {
    id,
    // n8n's Postgres driver writes dates as Eastern midnight in UTC (2026-11-03T05:00:00.000Z): the day is first.
    date: text("issue_date", "issueDate").slice(0, 10),
    title: text("title"),
    html: text("html"),
    featuredImageUrl: text("feature_image_url", "featureImageUrl"),
    scenePrompt: text("prompt_featured_image", "promptFeaturedImage"),
  };
}

export interface ReplayReport {
  date: string;
  n8nIssueId: number;
  status: "ready" | "failed";
  failedStep?: DraftStep;
  error?: string;
  title: { native: string | null; n8n: string };
  /** The content checks' findings (empty when the checks pass). */
  problems: string[];
  unreadStoryIds: number[];
  scenePrompt: string;
  ghlTemplate: string | null;
  /** Milliseconds per step. */
  timings: Partial<Record<DraftStep, number>>;
  totalMs: number;
  content: WrittenIssueContent | null;
}

export interface ReplayResult {
  nativeHtml: string;
  n8nHtml: string;
  report: ReplayReport;
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function errorPage(step: string, error: string): string {
  return `<!DOCTYPE html><html><body style="font-family: sans-serif; padding: 24px;"><h1>Native draft failed at ${escapeHtml(step)}</h1><p>${escapeHtml(error)}</p></body></html>`;
}

/**
 * produceDraft for a past date, with no issue or draft row: the image step returns n8n's image and scene prompt,
 * and the GHL step is a dry run. A draft that fails its checks is still rendered, so the owner can compare it.
 */
export async function replayDraft(
  input: { outline: ApprovalOutline; stories: ApprovedSections; n8nIssue: N8nIssue },
  deps: { writer?: IssueWriter; readArticles?: ReadArticles; openAIKey?: string } = {},
): Promise<ReplayResult> {
  const { outline, stories, n8nIssue } = input;
  if (n8nIssue.date !== outline.date) {
    throw new Error(`The n8n issue is for ${n8nIssue.date}, but the commit is for ${outline.date}.`);
  }
  const issue = { id: n8nIssue.id, date: outline.date };
  const draft = { id: 0, version: 1 };
  const started = Date.now();
  const base = { date: outline.date, n8nIssueId: n8nIssue.id, scenePrompt: n8nIssue.scenePrompt };

  try {
    const produced = await produceDraft(
      { outline, stories, issue, draft },
      {
        readArticles: deps.readArticles ?? readNoArticles,
        writer: deps.writer ?? createOpenAIIssueWriter({ apiKey: deps.openAIKey }),
        makeImage: async () => ({ imageUrl: n8nIssue.featuredImageUrl, scenePrompt: n8nIssue.scenePrompt }),
        // APP_ENV is fixed here, so this never reaches GHL whatever the shell says.
        createTemplate: (template) => createDraftTemplate(template, { env: { APP_ENV: "development" }, record: () => undefined }),
      },
    );
    return {
      nativeHtml: produced.html,
      n8nHtml: n8nIssue.html,
      report: {
        ...base,
        status: "ready",
        title: { native: produced.content.title, n8n: n8nIssue.title },
        problems: findContentProblems(produced.content, stories),
        unreadStoryIds: produced.unreadStoryIds,
        ghlTemplate: produced.ghlTemplateId,
        timings: produced.stepMs,
        totalMs: Date.now() - started,
        content: produced.content,
      },
    };
  } catch (error) {
    if (!(error instanceof DraftStepError)) throw error;
    const content = error.partial.content ?? null;
    const nativeHtml =
      error.partial.html ??
      (content
        ? renderIssueEmailHtml(content, { id: issue.id, issueDate: issue.date }, { id: draft.id, featuredImageUrl: n8nIssue.featuredImageUrl })
        : errorPage(error.step, error.message));
    return {
      nativeHtml,
      n8nHtml: n8nIssue.html,
      report: {
        ...base,
        status: "failed",
        failedStep: error.step,
        error: error.message,
        title: { native: content?.title ?? null, n8n: n8nIssue.title },
        problems: content ? findContentProblems(content, stories) : [],
        unreadStoryIds: error.partial.unreadStoryIds ?? [],
        ghlTemplate: error.partial.ghlTemplateId ?? null,
        timings: error.stepMs,
        totalMs: Date.now() - started,
        content,
      },
    };
  }
}

/** One page with each date's native and n8n emails side by side. */
export function renderReplayIndex(reports: ReplayReport[]): string {
  const sections = reports.map((report) => {
    const status =
      report.status === "ready" ? "ready" : `failed at ${escapeHtml(report.failedStep)}: ${escapeHtml(report.error ?? "")}`;
    const problems = report.problems.length
      ? `<ul class="problems">${report.problems.map((problem) => `<li>${escapeHtml(problem)}</li>`).join("")}</ul>`
      : "<p>All content checks pass.</p>";
    const date = escapeHtml(report.date);
    return `<section>
  <h2>${date} <small>(${status}; <a href="${date}.json">report</a>)</small></h2>
  ${problems}
  <div class="pair">
    <div><h3>Native: ${escapeHtml(report.title.native ?? "(no title)")}</h3><iframe src="${date}.native.html" title="Native ${date}"></iframe></div>
    <div><h3>n8n: ${escapeHtml(report.title.n8n)}</h3><iframe src="${date}.n8n.html" title="n8n ${date}"></iframe></div>
  </div>
</section>`;
  });
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Native drafts vs n8n</title>
<style>
  body { font-family: -apple-system, sans-serif; margin: 24px; color: #1c1917; }
  section { margin-bottom: 48px; }
  .pair { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  iframe { width: 100%; height: 1600px; border: 1px solid #d6d3d1; border-radius: 8px; }
  .problems { color: #b91c1c; }
  h3 { font-size: 15px; }
</style>
</head>
<body>
<h1>Native drafts vs n8n</h1>
<p>Steps timed: ${DRAFT_STEPS.join(", ")}. Images are n8n's; GHL was a dry run.</p>
${sections.join("\n")}
</body>
</html>
`;
}
