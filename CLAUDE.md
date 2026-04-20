# CLAUDE.md — lw-idp conventions

Guidance for future Claude-assisted sessions in this repo.

## Stack decisions (canonical)

See `docs/superpowers/specs/2026-04-20-lw-idp-foundation-design.md` for the authoritative architecture and tech stack. Key points:

- TypeScript end-to-end. No polyglot without an ADR.
- Turborepo + pnpm workspaces. Packages under `packages/*`, deployables under `apps/*`.
- Local K8s = kind (not Docker Desktop K8s). `./scripts/cluster-reset.sh dev` always rebuilds cleanly.
- Contracts are source of truth: `.proto` + OpenAPI in `packages/contracts/`. Hand-written API clients are rejected in review.
- Transactional outbox pattern for every domain write that publishes an event.
- All services expose `/healthz`, `/readyz`, `/metrics`. All services have ≥2 replicas and a PDB.

## Conventions

- Conventional Commits are enforced by Commitlint. Valid types: `feat|fix|chore|docs|test|refactor|perf|infra|ci|build|style|revert`.
- Biome for lint + format. Run `pnpm lint:fix` before committing.
- Run `pnpm test` at the package level before pushing; CI re-runs everything.
- TDD: write a failing test, then the minimal implementation, then commit.
- Frequent small commits. Never batch "lots of stuff."

## Where things live

- `apps/`            deployable services (one Docker image each)
- `packages/`        shared libs (never deployed, imported by apps)
- `charts/`          per-service Helm charts + umbrella `charts/lw-idp`
- `infra/`           non-Helm K8s config: kind profiles, operators, observability values
- `scripts/`         shell scripts, all idempotent, all `set -euo pipefail`
- `docs/adr/`        architecture decision records
- `docs/runbooks/`   on-call procedures per service
- `docs/superpowers/` brainstorming specs + implementation plans

## Don'ts

- Don't read another service's Postgres schema directly — use gRPC or NATS events.
- Don't hand-write gRPC clients/servers — use the codegen output under `packages/contracts/dist/`.
- Don't put secrets in Helm `values.yaml` — always reference via ESO or SealedSecrets.
- Don't add a new top-level tool without pinning it in `.mise.toml` and an ADR if it's load-bearing.
