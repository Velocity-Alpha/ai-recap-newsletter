/**
 * Test helper: a fake web for the article reader. Every page is invented; no real article text goes in the repo.
 */
import { vi } from "vitest";

import type { FetchInit, FetchLike } from "@/src/pipeline/draft/articles/http";

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
  return { fetch, calls };
}
