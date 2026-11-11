import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    environment: "node",
    include: ["src/tests/**/*.test.ts"],
    exclude: ["src/tests/evaluation/**"],
    testTimeout: 30000,
    hookTimeout: 30000,
    reporters: "default",
  },
});
