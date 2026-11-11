import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // The tsconfig.json paths. The specific ones come first: the first match wins.
    alias: {
      "@/components": path.resolve(__dirname, "src/components"),
      "@/features": path.resolve(__dirname, "src/features"),
      "@/lib": path.resolve(__dirname, "src/lib"),
      "@": path.resolve(__dirname, "."),
    },
  },
  test: {
    environment: "node",
    globals: true,
  },
});
