# ADR-002: Primary language — TypeScript end-to-end

- Status: Accepted
- Date: 2026-04-20

## Context
Solo builder. Need to minimize cognitive load across frontend + backend + shared libs.

## Decision
TypeScript 5.x end-to-end: Node 22 LTS on the backend, Next.js 15 on the frontend, shared packages in TS.

## Alternatives considered
- **Go for backend, TS for frontend**: Go is better for some K8s-native work (controllers) but polyglot overhead is high for solo; may revisit in P3/P4.
- **Rust for backend**: excellent performance, but slow iteration and steep compile times hurt solo velocity.

## Consequences
- One toolchain (pnpm + Turborepo + Biome + Vitest).
- Shared types via generated clients (`packages/contracts`).
- If we add Go later, it gets its own `apps/` subtree and its own build pipeline in Turborepo.
