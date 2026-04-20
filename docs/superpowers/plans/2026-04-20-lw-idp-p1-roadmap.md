# lw-idp — Project 1 Plan Roadmap

> Living index of the 10 implementation plans that deliver Project 1 ("Platform Foundation + UI Shell").
> Each plan produces working, testable software on its own. Plans are written **just-in-time** before executing them so they don't stale out.

**Spec:** `docs/superpowers/specs/2026-04-20-lw-idp-foundation-design.md`

## Plan sequence

| # | Filename (when written) | Scope | Ships / Demo | Status |
|---|---|---|---|---|
| **1.1** | `2026-04-20-lw-idp-p1.1-foundation-bootstrap.md` | Monorepo skeleton, shared package scaffolds, kind `dev` profile, all bootstrap scripts, platform operators via helmfile (cert-manager, ingress-nginx, CNPG, NATS, Dex, Dragonfly, kube-prometheus-stack, Loki, Tempo, Grafana) | `./scripts/cluster-reset.sh dev` → kind cluster with all infra pods Ready; `kubectl get clusters.postgresql.cnpg.io` shows a healthy Postgres cluster | **written, ready to execute** |
| 1.2 | TBD | App service skeletons (6 apps) + per-service Helm charts + Tiltfile + baseline GitHub Actions CI (lint, typecheck, unit test, build) | `tilt up` → all 6 app pods Ready on kind-dev; `curl .../healthz` returns 200 for each; CI green on `main` | pending |
| 1.3 | TBD | `identity-svc` end-to-end: Dex OIDC + user/team Postgres schema + gRPC surface + transactional outbox publishing | Browser-flow: `/auth/login` → GitHub OAuth → user row in DB, team memberships set, `idp.identity.user.created` event on NATS | pending |
| 1.4 | TBD | `catalog-svc` + `cluster-svc` (stubs) end-to-end | `grpcurl` / internal client can CRUD services and clusters; events fire; `service_tags` GIN search works | pending |
| 1.5 | TBD | `gateway-svc` (Fastify BFF) + session middleware + OpenAPI contract + rate limit + idempotency-key | Real browser session (HttpOnly cookie) authenticates against real identity-svc and hits real catalog-svc via gateway REST | pending |
| 1.6 | TBD | `notification-svc` + WebSocket fan-out + per-user authorization on events | Event on NATS → selectively pushed to the right user's connected browser within 500ms p95 | pending |
| 1.7 | TBD | `web` portal — all routes from spec §10.1 rendering (catalog/cluster real; deploys/pipelines mock via MSW adapters) | End-to-end user journey: login, browse catalog, create service, see it in list, register a cluster, view live WS event in toast | pending |
| 1.8 | TBD | Observability as code — Grafana dashboards + Alertmanager rules + SLO burn-rate checked into `infra/observability/` | Navigate to Grafana → per-service dashboards and SLO burn-rate panel populated from live traffic | pending |
| 1.9 | TBD | Security hardening — NetworkPolicies default-deny + explicit allow per service pair, PSA `restricted`, cosign signing, Trivy CI gates, External Secrets Operator + SealedSecrets, Vault-dev for local secrets | `kubectl auth can-i` respects PSA; unsigned image deploy rejected; Trivy blocks a seeded HIGH CVE in CI | pending |
| 1.10 | TBD | Full HA suite — kind-ha profile wired, chaos-mesh installed, HA smoke test (pod-kill + rolling deploy) + full chaos suite + k6 soak + `release-please` per app | `cluster-up.sh ha && pnpm test:ha` green; nightly chaos run reports zero 5xx; a tag push produces signed images + Helm OCI chart | pending |

## Writing rules

- Don't write plans ahead of execution. Write the next plan only when the current one is ≥ 90% executed and you're ~1 task from completion.
- If the spec changes while executing, update the roadmap row and re-draft the affected plan.
- Each plan starts with the writing-plans skill and ends with the two-option execution handoff.
