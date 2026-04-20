import type { UserConfig } from "@commitlint/types";

const config: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [
      2,
      "always",
      [
        "feat",
        "fix",
        "chore",
        "docs",
        "test",
        "refactor",
        "perf",
        "infra",
        "ci",
        "build",
        "style",
        "revert",
      ],
    ],
    "subject-case": [0],
  },
};

export default config;
