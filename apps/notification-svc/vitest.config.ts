import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 90_000,
    // Multiple test files share testcontainers-reused Postgres; parallel files
    // race on the same container (afterAll stop vs another file's query → ECONNREFUSED).
    // Serial file execution is fast enough and fully reliable.
    fileParallelism: false,
  },
});
