import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  esbuild: {
    jsx: "automatic",
  },
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: ["./test/setup.ts"],
    include: ["test/**/*.test.{ts,tsx}"],
    css: false,
  },
  resolve: {
    conditions: ["import", "default"],
    alias: {
      // The `server-only` marker package throws on its default export — that's
      // how it guards against Client Components importing server modules. In
      // RSC builds Next picks the `react-server` condition (no-op empty.js).
      // Vitest under jsdom is neither, so alias to a local no-op stub.
      "server-only": fileURLToPath(new URL("./test/__stubs__/server-only.ts", import.meta.url)),
    },
  },
});
