export interface RetryOptions {
  /** Attempts after the first one. */
  retries: number;
  /** Wait between attempts. */
  delayMs: number;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Runs `attempt` until it succeeds or `retries + 1` attempts have failed, like n8n's "Retry On Fail". */
export async function withRetries<T>(label: string, attempt: () => Promise<T>, options: RetryOptions): Promise<T> {
  const attempts = options.retries + 1;
  let lastError: unknown;
  for (let index = 0; index < attempts; index += 1) {
    if (index > 0 && options.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, options.delayMs));
    try {
      return await attempt();
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts: ${message(lastError)}`, { cause: lastError });
}
