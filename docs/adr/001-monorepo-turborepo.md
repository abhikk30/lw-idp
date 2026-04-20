# ADR-001: Monorepo tooling — Turborepo + pnpm workspaces

- Status: Accepted
- Date: 2026-04-20

## Context
Solo builder delivering ~6 deployable services + multiple shared libraries. Need fast installs, remote caching, and minimal ceremony.

## Decision
Use pnpm workspaces for package graph and Turborepo for pipeline orchestration + caching.

## Alternatives considered
- **Nx**: more powerful generators/plugins, but heavier config and more concepts for a solo monorepo.
- **pnpm workspaces alone**: fine, but we'd re-invent cached task orchestration.
- **Multi-repo + shared libs via npm**: shatters type sharing, increases coordination cost.

## Consequences
- `pnpm` is a hard dependency; contributors must install it (via mise).
- Turborepo remote cache (optional) speeds CI.
- If scale ever demands, Nx migration path exists.
