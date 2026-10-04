import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
      // Next's "server-only" guard throws outside a React Server bundle.
      "server-only": path.resolve(__dirname, "tests/server-only-stub.ts"),
    },
  },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["src/**/*.test.ts", "tests/unit/**/*.test.ts"], environment: "node" },
      },
      {
        extends: true,
        // Runs against DATABASE_URL (use a disposable database).
        test: { name: "integration", include: ["tests/integration/**/*.test.ts"], environment: "node", fileParallelism: false },
      },
    ],
  },
});
