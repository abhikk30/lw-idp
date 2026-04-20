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

## Docs

- Spec: `docs/superpowers/specs/2026-04-20-lw-idp-foundation-design.md`
- ADRs: `docs/adr/`
- Runbooks: `docs/runbooks/`
- Plans: `docs/superpowers/plans/`
