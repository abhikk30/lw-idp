# @lw-idp/config

Shared TypeScript and Turborepo presets consumed by every package in the monorepo.

- `tsconfig.base.json` — per-package `tsconfig.json` files extend this via `"extends": "@lw-idp/config/tsconfig"`.
- `turbo.base.json` — per-package `turbo.json` files extend this via `"extends": ["//"]` or directly.

This package is never deployed. It is a `workspace:*` dependency only.
