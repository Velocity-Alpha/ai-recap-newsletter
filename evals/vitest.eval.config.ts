import path from "path";
import { defineConfig } from "vitest/config";

/** Evals call real models, so `npm test` never runs them. Run them with `npm run eval` (evals/README.md). */
export default defineConfig({
  root: path.resolve(__dirname, ".."),
  resolve: {
    alias: {
      "@": path.resolve(__dirname, ".."),
    },
  },
  test: {
    environment: "node",
    globals: true,
    include: ["evals/**/*.eval.ts"],
    // One eval file at a time: each sweep has its own caps on runs and judge calls (EVAL_CONCURRENCY,
    // EVAL_JUDGE_CONCURRENCY), and every call shares the process-wide rate limiters (evals/lib/rate-limit.ts).
    fileParallelism: false,
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
  },
});
