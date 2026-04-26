import type { TestRunnerConfig } from "@storybook/test-runner";

/**
 * Test-runner config for `pnpm test-storybook`.
 *
 * Default: runs every story's `play()` function. Stories without a play()
 * just smoke-test that the component renders without throwing.
 */
const config: TestRunnerConfig = {
  // Default tags applied to every story. Stories can override.
  tags: {
    include: ["interactions"],
  },
};

export default config;
