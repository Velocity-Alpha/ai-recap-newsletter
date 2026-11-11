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
    // One eval file at a time: each one is a sweep with its own concurrency limit.
    fileParallelism: false,
    testTimeout: 4 * 60 * 60 * 1000,
    hookTimeout: 10 * 60 * 1000,
  },
});
