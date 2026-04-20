# ADR-005: Local Kubernetes substrate — kind

- Status: Accepted
- Date: 2026-04-20

## Context
Need a local K8s cluster for development and integration testing. Must be scriptable, reset-able, and capable of multi-node for HA testing.

## Decision
kind (Kubernetes-in-Docker), two named profiles: `lw-idp-dev` (fast loop, 1 control-plane + 1 worker) and `lw-idp-ha` (1 control-plane + 3 workers for HA + chaos). Docker Desktop provides the container engine; its bundled K8s is unused.

## Alternatives considered
- **Docker Desktop K8s**: single node, not scriptable, stateful across resets.
- **k3d**: similar to kind, slightly lighter, but kind is the CNCF-adopted default for cluster API conformance testing.
- **minikube**: heavier, slower, larger toolchain.

## Consequences
- Same `infra/kind/*.yaml` profiles run locally and in CI (`helm/kind-action`) — bit-identical.
- Full teardown + rebuild is ~2 minutes, enabling aggressive resets.
- Same Helm charts and operators deploy to kind, staging, and prod clusters.
