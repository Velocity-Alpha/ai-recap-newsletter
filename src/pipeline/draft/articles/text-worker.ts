import { isMainThread, parentPort, Worker, workerData } from "node:worker_threads";

import { HostLimiter } from "@/src/pipeline/draft/articles/http";
import { parseJobText, transferList, type ParseJob } from "@/src/pipeline/draft/articles/text-job";

/**
 * Runs the reader's text work (text-job.ts) in a worker thread, so a hostile page cannot hang the draft job or
 * use up its memory. Each job gets a fresh worker with a heap limit; the worker is stopped when the method's
 * timeout or the step's deadline aborts, or when it runs out of heap.
 *
 * The worker runs this same file. In the Netlify function that file is the function's one bundled `.mjs`, which
 * has all the reader code in it, so no other file has to ship. Run from TypeScript source (Vitest, vite-node
 * scripts) there is no JavaScript file to start, so the work stays in this thread, behind the HTML guard only.
 */

/** Does one text job. It calls `onStart` when the job gets its worker slot, so its text limit can start then. */
export type TextParser = (job: ParseJob, signal: AbortSignal, onStart: () => void) => Promise<string>;

/** #120 review: enough for real pages (the largest tried used under 100 MB), far below the function's memory. */
export const WORKER_HEAP_MB = 256;
/** Workers at once, across every story being read. Three hostile pages at the heap limit (768 MB) still fit in the 1,024 MB function. */
export const MAX_WORKERS = 3;

const WORKER_KEY = "aiRecapTextWorker";

type WorkerReply = { text: string } | { error: string };

// Inside a worker started below: do the one job and send back the text.
if (!isMainThread && parentPort && (workerData as Record<string, unknown> | null)?.[WORKER_KEY] === true) {
  const port = parentPort;
  port.once("message", async (job: ParseJob) => {
    let reply: WorkerReply;
    try {
      reply = { text: await parseJobText(job) };
    } catch (error) {
      reply = { error: error instanceof Error ? error.message : String(error) };
    }
    port.postMessage(reply);
  });
}

/** The text work failed or was stopped for a reason other than the abort signal. */
export class TextJobError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TextJobError";
  }
}

/** In this thread. Only the HTML guard protects it. */
export const parseInThisThread: TextParser = async (job, signal, onStart) => {
  if (signal.aborted) throw signal.reason;
  onStart();
  return parseJobText(job);
};

function runInWorker(entry: URL, job: ParseJob, signal: AbortSignal, heapMb: number): Promise<string> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const worker = new Worker(entry, {
      workerData: { [WORKER_KEY]: true },
      resourceLimits: { maxOldGenerationSizeMb: heapMb, maxYoungGenerationSizeMb: Math.min(32, heapMb) },
    });
    let settled = false;
    const finish = (settle: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      void worker.terminate();
      settle();
    };
    const onAbort = () => finish(() => reject(signal.reason));
    signal.addEventListener("abort", onAbort, { once: true });

    worker.once("message", (reply: WorkerReply) =>
      finish(() => ("text" in reply ? resolve(reply.text) : reject(new TextJobError(`Could not take the text: ${reply.error}`)))),
    );
    worker.once("error", (error: Error & { code?: string }) =>
      finish(() =>
        reject(
          new TextJobError(
            error.code === "ERR_WORKER_OUT_OF_MEMORY" ? `The page needed over ${heapMb} MB to read.` : `The text worker failed: ${error.message}`,
          ),
        ),
      ),
    );
    worker.once("exit", (code) => finish(() => reject(new TextJobError(`The text worker stopped early (exit code ${code}).`))));
    worker.postMessage(job, transferList(job));
  });
}

/** Each job in a fresh worker started from `entry`, at most `maxWorkers` at once. */
export function createWorkerParser(entry: URL, options: { heapMb?: number; maxWorkers?: number } = {}): TextParser {
  const heapMb = options.heapMb ?? WORKER_HEAP_MB;
  const slots = new HostLimiter(options.maxWorkers ?? MAX_WORKERS);
  return (job, signal, onStart) =>
    slots.run("worker", signal, () => {
      onStart();
      return runInWorker(entry, job, signal, heapMb);
    });
}

/** True when this module runs as built JavaScript, so a worker can start from it. */
export function canStartWorker(moduleUrl: string = import.meta.url): boolean {
  return /\.[cm]?js$/.test(new URL(moduleUrl).pathname);
}

let sharedParser: TextParser | null = null;

/** The worker when this module is built JavaScript (the Netlify function); this thread otherwise. */
export function defaultTextParser(): TextParser {
  if (!canStartWorker()) return parseInThisThread;
  sharedParser ??= createWorkerParser(new URL(import.meta.url));
  return sharedParser;
}
