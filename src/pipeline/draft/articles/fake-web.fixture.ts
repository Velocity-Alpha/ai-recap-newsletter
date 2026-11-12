/**
 * Test helper: a fake web for the article reader. Every page is invented; no real article text goes in the repo.
 */
import { vi } from "vitest";

import type { FetchInit, FetchLike } from "@/src/pipeline/draft/articles/http";
import { parseJobText } from "@/src/pipeline/draft/articles/text-job";
import type { MethodContext } from "@/src/pipeline/draft/articles/types";

/**
 * A method's text jobs, in this thread, for tests that call a method directly. It does not import text-worker.ts,
 * which imports http.ts: tests that mock http.ts load this fixture inside the mock.
 */
export const parseHere: MethodContext["parse"] = async (job, signal) => {
  if (signal.aborted) throw signal.reason;
  return parseJobText(job);
};

/** A response, or `hang` for a request that never answers and ignores its abort signal. */
export type Route = (() => Response | Promise<Response>) | "hang";

export const hang = "hang" as const;

/** Invented prose of about `chars` characters, with a marker so tests can tell pages apart. */
export function prose(marker: string, chars = 1_200): string {
  const sentence = `The ${marker} pretend lab shared made-up results about a toy model trained on synthetic data. `;
  return sentence.repeat(Math.ceil(chars / sentence.length)).slice(0, chars).trim();
}

export function htmlPage(text: string, status = 200): () => Response {
  const paragraphs = text.match(/[^.]+\./g) ?? [text];
  const body = `<!DOCTYPE html><html><body><nav>Home News</nav><article><h1>Pretend story</h1>${paragraphs
    .map((sentence) => `<p>${sentence.trim()}</p>`)
    .join("")}</article><footer>Fake footer</footer></body></html>`;
  return () => new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });
}

/** Generated hostile HTML (#120 review). Each kind made Readability run for seconds to minutes, or run out of memory. */
export const hostileHtml = {
  /** Tags nested `levels` deep. 4,000 levels took 122 s. */
  deep: (levels: number) => `<html><body>${"<div>".repeat(levels)}Pretend text.${"</div>".repeat(levels)}</body></html>`,
  /** `count` tiny elements. 600,000 (4.8 MB) used over 700 MB. */
  tiny: (count: number) => `<html><body>${"<b>x</b>".repeat(count)}</body></html>`,
};

export function rawHtml(html: string): () => Response {
  return () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

/**
 * A one-page PDF of `text` in Helvetica, wrapped at about 80 characters a line. Built by hand (PDF 1.4, one font,
 * one content stream), so the fixture is small and its text is known.
 */
export function pdfDocument(text: string): Uint8Array {
  const lines = text.match(/.{1,80}(\s|$)/g)?.map((line) => line.trim()) ?? [text];
  const escape = (line: string) => line.replace(/[\\()]/g, (char) => `\\${char}`);
  const content = `BT /F1 10 Tf 13 TL 40 760 Td ${lines.map((line) => `(${escape(line)}) Tj T*`).join(" ")} ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let file = "%PDF-1.4\n";
  const offsets = objects.map((object, index) => {
    const offset = file.length;
    file += `${index + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = file.length;
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(file);
}

export function pdfResponse(bytes: Uint8Array, headers: Record<string, string> = {}): () => Response {
  return () => new Response(bytes.slice(), { headers: { "content-type": "application/pdf", ...headers } });
}

export function jinaAnswer(url: string, text: string, httpStatus = 200): () => Response {
  return () =>
    new Response(JSON.stringify({ code: 200, status: 20000, data: { url, content: text, httpStatus } }), {
      headers: { "content-type": "application/json" },
    });
}

export function jinaError(status: number, message: string): () => Response {
  return () => new Response(JSON.stringify({ code: status, readableMessage: message }), { status, headers: { "content-type": "application/json" } });
}

export function jinaUrl(url: string): string {
  return `https://r.jina.ai/${url}`;
}

/** A fetch that answers from `routes` by exact URL, and 404s anything else. */
export function fakeWeb(routes: Record<string, Route>) {
  const calls: string[] = [];
  const fetch = vi.fn<FetchLike>((url: string, init: FetchInit) => {
    calls.push(url);
    const route = routes[url];
    if (route === "hang") return new Promise<never>(() => undefined);
    if (!route) return Promise.resolve(new Response("Not found", { status: 404, headers: { "content-type": "text/html" } }));
    void init;
    return Promise.resolve(route());
  });
  /** Whether the first request to `url` sent an Authorization header (in any case). */
  const sentAuthorization = (url: string): boolean => {
    const call = fetch.mock.calls.find(([called]) => called === url);
    if (!call) throw new Error(`No request to ${url}.`);
    return Object.keys(call[1].headers).some((name) => name.toLowerCase() === "authorization");
  };
  return { fetch, calls, sentAuthorization };
}
