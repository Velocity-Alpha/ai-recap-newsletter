/**
 * Builds the golden-set labeling page (#177): one local HTML file with no server. It holds the batch's stories, the
 * recommendations and the bundled page code (`page-ui.ts`, which loads `labels.ts`).
 *
 * The page shows headline, summary, source and link only. It never holds the owner's past action on a story, the
 * extraction category or the extraction importance: the builder copies the allowed fields one by one.
 */
import type { Recommendation } from "@/evals/section-scoring/labels";

export interface PageStory {
  id: number;
  inputHash: string;
  headline: string;
  summary: string;
  source: string;
  url: string | null;
  /** Null when the recommendation is hidden (part of the check set). */
  recommendation: Recommendation | null;
}

/** What `page-ui.ts` reads from the page. */
export interface PageData {
  batch: string;
  scoringVersion: string;
  levels: { label: string; description: string }[];
  stories: PageStory[];
}

export interface PageInput extends PageData {
  /** The bundled page code. */
  script: string;
}

/** JSON that is safe inside a script tag: no "<", ">" or "&", and no line separators that break old parsers. */
function scriptJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

const escapeHtml = (text: string) => text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function buildPage(input: PageInput): string {
  const data: PageData = {
    batch: input.batch,
    scoringVersion: input.scoringVersion,
    levels: input.levels.map((level) => ({ label: level.label, description: level.description })),
    stories: input.stories.map((story) => ({
      id: story.id,
      inputHash: story.inputHash,
      headline: story.headline,
      summary: story.summary,
      source: story.source,
      url: story.url,
      recommendation: story.recommendation ? { kind: story.recommendation.kind, importance: story.recommendation.importance } : null,
    })),
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Golden set · ${escapeHtml(input.batch)}</title>
<style>${STYLE}</style>
</head>
<body>
<header>
  <div class="brand">AI Recap · golden set <span class="batch">${escapeHtml(input.batch)}</span></div>
  <div id="progress"></div>
  <button id="export" type="button">Export labels</button>
</header>
<main id="app"></main>
<footer id="keys"></footer>
<script type="application/json" id="page-data">${scriptJson(data)}</script>
<script>${input.script.replace(/<\/script/gi, "<\\/script")}</script>
</body>
</html>
`;
}

const STYLE = `
:root { --paper: #f6f1e7; --ink: #1f1c17; --muted: #6f675b; --rule: #d9cfbd; --accent: #a4462b; --soft: #efe6d6; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font: 16px/1.5 -apple-system, "Helvetica Neue", Arial, sans-serif; }
header { display: flex; align-items: center; gap: 24px; padding: 14px 32px; border-bottom: 1px solid var(--rule); }
.brand { font-family: Georgia, "Iowan Old Style", serif; font-size: 18px; letter-spacing: .02em; }
.batch { color: var(--muted); font-style: italic; }
#progress { flex: 1; color: var(--muted); font-size: 14px; }
#progress .bar { height: 3px; background: var(--rule); margin-top: 6px; border-radius: 2px; overflow: hidden; }
#progress .bar span { display: block; height: 100%; background: var(--accent); }
button { font: inherit; font-size: 14px; padding: 6px 14px; border: 1px solid var(--ink); background: transparent; color: var(--ink); border-radius: 3px; cursor: pointer; }
button:hover { background: var(--ink); color: var(--paper); }
main { max-width: 760px; margin: 0 auto; padding: 40px 32px 140px; }
.source { text-transform: uppercase; letter-spacing: .12em; font-size: 12px; color: var(--muted); }
h1 { font-family: Georgia, "Iowan Old Style", serif; font-weight: normal; font-size: 30px; line-height: 1.25; margin: 8px 0 14px; }
h1 a { color: inherit; text-decoration: none; border-bottom: 1px solid var(--rule); }
h1 a:hover { border-color: var(--accent); }
.summary { font-size: 17px; color: #3a352d; margin: 0 0 28px; white-space: pre-line; }
.row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin: 14px 0; }
.row .name { width: 96px; font-size: 13px; color: var(--muted); text-transform: uppercase; letter-spacing: .08em; }
.chip { position: relative; padding: 7px 13px; border: 1px solid var(--rule); border-radius: 3px; background: #fffdf8; font-size: 15px; }
.chip kbd { font: 12px ui-monospace, Menlo, monospace; color: var(--muted); margin-right: 6px; }
.chip.on { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.chip.on kbd { color: #cfc6b6; }
.chip.also { border: 1px dashed var(--accent); color: var(--accent); }
.chip.rec::after { content: "recommended"; position: absolute; top: -9px; right: 6px; font-size: 10px; background: var(--paper); color: var(--accent); padding: 0 4px; letter-spacing: .04em; }
.level { font-size: 14px; color: var(--muted); margin: 4px 0 0 106px; min-height: 42px; }
.status { margin-top: 26px; padding: 12px 16px; background: var(--soft); border-left: 3px solid var(--rule); font-size: 15px; }
.status.changed { border-color: var(--accent); }
.status.saved { border-color: #5d7a4f; }
.message { color: var(--accent); font-weight: 600; margin-top: 8px; }
.reason { display: none; margin-top: 14px; }
.reason.open { display: block; }
.reason input { width: 100%; font: inherit; padding: 10px 12px; border: 1px solid var(--ink); border-radius: 3px; background: #fffdf8; }
.reason small { display: block; color: var(--muted); margin-top: 6px; }
.done { text-align: center; padding-top: 60px; }
.done h1 { margin-bottom: 8px; }
footer { position: fixed; bottom: 0; left: 0; right: 0; padding: 10px 32px; background: var(--paper); border-top: 1px solid var(--rule); font-size: 13px; color: var(--muted); }
footer kbd { font: 12px ui-monospace, Menlo, monospace; border: 1px solid var(--rule); border-radius: 3px; padding: 0 5px; background: #fffdf8; color: var(--ink); }
`;
