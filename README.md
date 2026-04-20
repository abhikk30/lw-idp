# lw-idp

Internal Developer Platform — microservices orchestrator that wraps Jenkins (build), ArgoCD (GitOps deploy), GitHub (SCM), and multi-cluster K8s behind a single portal.

This repository is a pnpm/Turborepo monorepo containing every service, Helm chart, and piece of infra-as-code needed to ship the platform.

## Quick start

```bash
# one-time per machine
brew install docker mise mkcert
mise install            # installs kind, kubectl, helm, tilt, node, pnpm, buf, helmfile
mkcert -install

# daily
pnpm install
./scripts/cluster-up.sh dev
./scripts/cluster-bootstrap.sh dev   # operators + platform infra
# (once there are service apps:) tilt up
```

## Resetting the environment

```bash
./scripts/cluster-reset.sh dev    # down → up → bootstrap in ~2 min
./scripts/cluster-nuke.sh         # destructive: clusters + registry + caches
```

## Development workflow

1. **Start the cluster** — `./scripts/cluster-up.sh dev`
2. **Install platform infra** — `./scripts/cluster-bootstrap.sh dev`
3. **Diagnose** (anytime) — `./scripts/cluster-doctor.sh dev`
4. **Reset** (when things feel weird) — `./scripts/cluster-reset.sh dev`

Every check-in is gated by Lefthook (Biome + Commitlint) locally and by the `ci` workflow on PR.

### Repo tour

| Path | Purpose |
|---|---|
| `apps/` | deployable services (populated starting Plan 1.2) |
| `packages/` | shared libraries |
| `charts/` | per-service Helm charts + `charts/lw-idp` umbrella (Plan 1.2+) |
| `infra/kind/` | kind cluster profiles |
| `infra/helmfile.yaml` + `infra/helmfile/*.yaml` | pinned operator/chart versions |
| `infra/{cnpg,nats,dex,dragonfly,observability}/` | operator CRs + values |
| `scripts/` | idempotent dev automation |
| `docs/adr/` | Architecture Decision Records |
| `docs/superpowers/specs/` | design specs |
| `docs/superpowers/plans/` | implementation plans |

## Docs

- Spec: `docs/superpowers/specs/2026-04-20-lw-idp-foundation-design.md`
- ADRs: `docs/adr/`
- Runbooks: `docs/runbooks/`
- Plans: `docs/superpowers/plans/`
