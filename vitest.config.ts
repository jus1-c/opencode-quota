import { defineConfig } from "vitest/config";

export default defineConfig({
  oxc: {
    jsx: {
      runtime: "automatic",
      importSource: "@opentui/solid",
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    setupFiles: ["tests/setup.ts"],
    // Tests that run git, build, or open SQLite take 7-11 s on the Windows CI runner and on a
    // busy machine, past Vitest's 5 s default. A test that really hangs still fails.
    testTimeout: 30_000,
  },
});
