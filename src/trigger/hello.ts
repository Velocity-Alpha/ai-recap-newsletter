import { logger, task } from "@trigger.dev/sdk";

export type HelloPayload = { name?: string };
export type HelloResult = { message: string; at: string };

export function buildHelloMessage(payload: HelloPayload, now: Date): HelloResult {
  const name = payload.name?.trim() || "world";
  return {
    message: `Hello, ${name}. The Trigger.dev runner is working.`,
    at: now.toISOString(),
  };
}

// Smoke-test task that proves the runner works end to end. It touches no database or external service.
export const helloTask = task({
  id: "hello",
  maxDuration: 30,
  run: async (payload: HelloPayload): Promise<HelloResult> => {
    const result = buildHelloMessage(payload, new Date());
    logger.info(result.message, { at: result.at });
    return result;
  },
});
