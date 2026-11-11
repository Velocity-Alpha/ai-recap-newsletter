import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { pdfDocument, prose } from "@/src/pipeline/draft/articles/fake-web.fixture";
import { canStartWorker, defaultTextParser, parseInThisThread } from "@/src/pipeline/draft/articles/text-worker";

const root = path.resolve(__dirname, "../../../..");

// Run in a child process from the bundle, so it is the bundled worker that runs, with no Vitest in the way.
const PROBE = `
const [bundleUrl, pdfPath] = process.argv.slice(2);
const bundle = await import(bundleUrl);
const { readFileSync } = await import("node:fs");
const sentence = "The pretend lab shared made-up results about a toy model trained on synthetic data. ";
const page = \`<html><body><article><h1>Pretend story</h1>\${\`<p>\${sentence.repeat(6)}</p>\`.repeat(10)}</article></body></html>\`;
// Passes the HTML guard (300 deep, about 24,000 elements), but Readability takes seconds on it.
const subtree = \`\${"<div>".repeat(300)}<p>\${sentence}</p>\${"</div>".repeat(300)}\`;
const slow = \`<html><body>\${subtree.repeat(80)}</body></html>\`;
const deep = \`<html><body>\${"<div>".repeat(4000)}<p>\${sentence}</p>\${"</div>".repeat(4000)}</body></html>\`;
const tiny = \`<html><body>\${"<i>a</i>".repeat(600000)}</body></html>\`;

const elapsed = (started) => Math.round(performance.now() - started);
async function parse(parser, html, timeoutMs) {
  const started = performance.now();
  try {
    const text = await parser({ kind: "readable", html }, AbortSignal.timeout(timeoutMs), () => undefined);
    return { ms: elapsed(started), text: text.slice(0, 120) };
  } catch (error) {
    return { ms: elapsed(started), error: \`\${error.name}: \${error.message}\` };
  }
}

const parser = bundle.defaultTextParser();
const out = { canStartWorker: bundle.canStartWorker(), slowPassesGuard: bundle.guardHtml(slow).ok };
out.page = await parse(parser, page, 10000);
out.slow = await parse(parser, slow, 500);
out.deep = await parse(parser, deep, 1000);
out.tiny = await parse(bundle.createWorkerParser(new URL(bundleUrl), { heapMb: 64 }), tiny, 30000);
out.pageAfter = await parse(parser, page, 10000);

async function parsePdf(bytes) {
  const started = performance.now();
  let slot = false;
  try {
    const text = await parser({ kind: "pdf", bytes }, AbortSignal.timeout(10000), () => (slot = true));
    // The bytes moved to the worker, so this thread's copy is now empty.
    return { ms: elapsed(started), slot, sentBytes: bytes.byteLength, text: text.slice(0, 120) };
  } catch (error) {
    return { ms: elapsed(started), slot, error: \`\${error.name}: \${error.message}\` };
  }
}
const pdf = new Uint8Array(readFileSync(pdfPath));
out.pdf = await parsePdf(pdf.slice());
out.brokenPdf = await parsePdf(new TextEncoder().encode("%PDF-1.4 This is not really a PDF."));
const pdfFetch = async () => new Response(pdf.slice(), { headers: { "content-type": "application/pdf" } });
const pdfRead = await bundle.readArticle("https://news.example.com/filing.pdf", { fetch: pdfFetch });
out.pdfRead = { status: pdfRead.status, method: pdfRead.method, text: pdfRead.text?.slice(0, 120), textMs: pdfRead.attempts[0]?.textMs };

const fetch = async (url) =>
  url.startsWith("https://r.jina.ai/")
    ? new Response(JSON.stringify({ code: 200, status: 20000, data: { url, content: sentence.repeat(20), httpStatus: 200 } }), { headers: { "content-type": "application/json" } })
    : new Response(slow, { headers: { "content-type": "text/html" } });
const started = performance.now();
const read = await bundle.readArticle("https://news.example.com/slow", { fetch, limits: { text: 500 } });
out.read = { ms: elapsed(started), status: read.status, method: read.method, attempts: read.attempts.map(({ method, outcome, error }) => ({ method, outcome, error })) };

console.log(JSON.stringify(out));
process.exit(0);
`;

type Parsed = { ms: number; text?: string; error?: string };
interface ProbeResult {
  canStartWorker: boolean;
  slowPassesGuard: boolean;
  page: Parsed;
  slow: Parsed;
  deep: Parsed;
  tiny: Parsed;
  pageAfter: Parsed;
  pdf: Parsed & { slot: boolean; sentBytes?: number };
  brokenPdf: Parsed & { slot: boolean };
  pdfRead: { status: string; method: string | null; text?: string; textMs?: number };
  read: { ms: number; status: string; method: string | null; attempts: Array<{ method: string; outcome: string; error?: string }> };
}

/**
 * The text worker starts from its module's own file, so it only works once built. This builds each function that
 * reads articles the way Netlify does (one esbuild ESM file, @prisma/client external, a require shim) and runs real
 * parses through the worker from that file.
 */
describe.each(["draft-issue-background", "find-free-links-background"])("the text worker in the bundled %s function", (functionName) => {
  let dir: string;
  let result: ProbeResult;

  beforeAll(async () => {
    // Inside the repo, so the bundle's external packages resolve from node_modules.
    mkdirSync(path.join(root, "node_modules/.cache"), { recursive: true });
    dir = mkdtempSync(path.join(root, "node_modules/.cache/text-worker-bundle-"));
    const entry = path.join(dir, "entry.ts");
    const outfile = path.join(dir, `${functionName}.mjs`);
    writeFileSync(
      entry,
      [
        `export { default } from ${JSON.stringify(path.join(root, `netlify/functions/${functionName}.mts`))};`,
        `export { guardHtml, readArticle } from ${JSON.stringify(path.join(root, "src/pipeline/draft/articles/index.ts"))};`,
        `export { canStartWorker, createWorkerParser, defaultTextParser } from ${JSON.stringify(path.join(root, "src/pipeline/draft/articles/text-worker.ts"))};`,
      ].join("\n"),
    );
    await build({
      entryPoints: [entry],
      outfile,
      bundle: true,
      platform: "node",
      target: "node20",
      format: "esm",
      external: ["@prisma/client"],
      banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
      logLevel: "silent",
    });
    const probe = path.join(dir, "probe.mjs");
    writeFileSync(probe, PROBE);
    const pdf = path.join(dir, "filing.pdf");
    writeFileSync(pdf, pdfDocument(prose("filing")));

    const { stdout } = await promisify(execFile)(process.execPath, [probe, pathToFileURL(outfile).href, pdf], { cwd: root, timeout: 90_000 });
    result = JSON.parse(stdout.trim().split("\n").at(-1)!);
  }, 120_000);

  afterAll(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
  });

  it("starts the worker from the bundled file and reads a normal page", () => {
    expect(result.canStartWorker).toBe(true);
    expect(result.page.text).toContain("The pretend lab shared made-up results");
    expect(result.pageAfter.text).toContain("The pretend lab shared made-up results");
  });

  it("stops a page that passes the HTML guard but is slow to parse, at the timeout", () => {
    expect(result.slowPassesGuard).toBe(true);
    expect(result.slow.error).toMatch(/^TimeoutError/);
    expect(result.slow.ms).toBeLessThan(500 + 1_500);
  });

  it("stops 4,000-deep nesting at the timeout instead of after two minutes", () => {
    expect(result.deep.error).toMatch(/^TimeoutError/);
    expect(result.deep.ms).toBeLessThan(1_000 + 1_500);
  });

  it("stops a page that needs more memory than the worker's heap, without taking the function down", () => {
    expect(result.tiny.error).toBe("TextJobError: The page needed over 64 MB to read.");
  });

  it("reads a PDF in a worker started from the bundled file, so unpdf works inside the bundle", () => {
    expect(result.pdf).toMatchObject({ slot: true, sentBytes: 0 });
    expect(result.pdf.text).toContain("The filing pretend lab shared made-up results");
    expect(result.brokenPdf).toMatchObject({ slot: true, error: expect.stringMatching(/^TextJobError: Could not take the text: Not a readable PDF: /) });
    expect(result.pdfRead).toMatchObject({ status: "read", method: "pdf", text: expect.stringContaining("The filing pretend lab") });
    expect(result.pdfRead.textMs).toBeGreaterThanOrEqual(0);
  });

  it("ends the fetch method at its text limit and moves on to Jina", () => {
    // Jina's own text job has the same short limit, and a worker can take that long to start under load, so only
    // that Jina was asked is checked, not that it read the page.
    expect(result.read.attempts.map(({ method }) => method)).toEqual(["fetch", "jina"]);
    expect(result.read.attempts[0]).toMatchObject({ method: "fetch", outcome: "failed", error: "Text part timed out after 0.5 s." });
    expect(result.read.ms).toBeLessThan(500 + 500 + 2_000);
  });
});

describe("the text worker from TypeScript source", () => {
  it("parses in this thread, as there is no built file to start a worker from", () => {
    expect(canStartWorker()).toBe(false);
    expect(canStartWorker("file:///var/task/draft-issue-background.mjs")).toBe(true);
    expect(defaultTextParser()).toBe(parseInThisThread);
  });
});
