import { defineConfig } from "@trigger.dev/sdk";

export default defineConfig({
  project: "proj_vhdnmugmscjvjmsbvpah",
  dirs: ["./src/trigger"],
  runtime: "node",
  logLevel: "log",
  // Compute-time cap per run, in seconds. Waits do not count. Long LLM steps take up to about 300 s today.
  maxDuration: 900,
  retries: {
    enabledInDev: false,
    default: {
      maxAttempts: 3,
      minTimeoutInMs: 1000,
      maxTimeoutInMs: 10000,
      factor: 2,
      randomize: true,
    },
  },
});
