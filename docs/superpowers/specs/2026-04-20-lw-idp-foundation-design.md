# lw-idp — Project 1 Foundation + UI Shell — Design Spec

- **Date:** 2026-04-20
- **Author:** Abhishek Kumar (solo)
- **Status:** Approved (brainstorm), ready for implementation planning
- **Scope:** Sub-project 1 of 6 in the lw-idp roadmap — platform foundation plus a complete portal UI with integration data mocked. Projects 2–6 (SCM/build, GitOps deploy, multi-cluster, scaffolding, RBAC/observability-extensions) get their own spec cycles later.

---

## 1. Product Context

`lw-idp` is an Internal Developer Platform (IDP) portal — a single pane of glass that orchestrates and deploys microservices on Kubernetes by wrapping best-of-breed OSS (Jenkins for build, ArgoCD for GitOps deploy, GitHub for SCM, kubeconfig-targeted multi-cluster K8s). It is a **commercial product** targeting mid-market (50–500 devs, 1–3 platform engineers) and enterprise teams that find Backstage too much work and Port too expensive.

Non-negotiable requirements (set by the user):

1. **Scalable microservices architecture**; the IDP itself is a set of small services, not a monolith.
2. **No single point of failure** — every tier is replicated or quorum-based.
3. **Production-ready** quality scaffolding from day one (tests, CI, observability, security).
4. **Monorepo** — every component of the product ships from one repository.
5. **Thoroughly tested** — unit, integration, contract, e2e, a11y, load, and chaos tests exist and gate CI.
6. **Best-practices-by-default** for every piece of the stack.
7. **Local dev** uses **kind** — scripted, JIT, fully resettable. Docker Desktop provides the engine, but its bundled K8s is not used.
8. **Solo builder** — all choices optimize for single-person cognitive load; prefer opinionated defaults, one primary language, minimal ceremony.
9. **UI-first for Project 1** — every major screen of the portal must render with real domain data (catalog/clusters/identity) and mocked integration data (deploys/pipelines/git).

---

## 2. Sub-Project Decomposition (Roadmap)

| # | Sub-project | Scope |
|---|---|---|
| **1** | **Platform Foundation + UI Shell** *(this spec)* | Real microservices backend for identity, catalog, clusters, notifications + complete Next.js portal with integrations mocked |
| 2 | SCM + Build Integration | GitHub connector, Jenkins connector, build status event aggregation, pipeline UI |
| 3 | GitOps Deploy (ArgoCD) | ArgoCD connector, app registration/sync/rollback, promotion flows, deploy UI — lw-idp starts dogfooding itself here |
| 4 | Multi-Cluster Management | Cluster registry (full), target selection policies, namespace/quota, cluster explorer UI |
| 5 | Scaffolding & Templates | Golden-path template engine, end-to-end "create service" wizard (repo + pipeline + ArgoCD app) |
| 6 | RBAC/Teams/Multi-Tenancy & Observability Extensions | Casbin/OPA policies, tenant isolation, observability aggregator view, audit log service |

Each sub-project gets its own `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md` → implementation plan → build cycle. This spec covers sub-project 1 only.

---

## 3. Tech Stack (Project-wide)

Optimized for solo builder, monorepo, cloud-native, no-SPoF. Reflects April 2026 best-of-breed.

| Concern | Choice | Rationale |
|---|---|---|
| Monorepo tooling | **Turborepo + pnpm workspaces** | Fast install (pnpm), remote cache (Turborepo), low ceremony vs. Nx |
| Language | **TypeScript 5.x end-to-end** — Node 22 LTS backend, Next.js 15 frontend, shared `packages/*` | One toolchain, shared types via codegen, lowest solo friction |
| Frontend | Next.js 15 (App Router, React 19, RSC), Tailwind CSS v4, shadcn/ui, TanStack Query/Table, Zustand, react-hook-form + Zod, lucide-react, sonner, cmdk, next-intl | Batteries-included, a11y-first (Radix), no vendor lock on component library |
| Backend framework | **Fastify** + TypeScript strict + Zod schemas | Mature, fast, first-class schema-to-OpenAPI generation |
| Database | **PostgreSQL 16**, **Drizzle ORM** | HA via CloudNativePG operator (3-node); typed schemas; testcontainers-friendly |
| Messaging | **NATS JetStream** (3-node cluster) | Lighter than Kafka, native Raft quorum, plenty for IDP events |
| Cache / session | **Dragonfly** (or Redis Sentinel 3-node fallback) | HA key-value store |
| OIDC broker | **Dex** (→ GitHub upstream for P1) | Stateless broker, easy to federate SAML/LDAP later for enterprise |
| Gateway | Custom Fastify BFF (HA multi-replica) | Single sync entry for the browser, aggregation, rate-limit |
| Service-to-service | **gRPC via ConnectRPC** (Protobuf, `buf` for lint/breaking) | Typed, codegen-first, HTTP/2-native |
| Ingress / TLS | ingress-nginx (HA) + cert-manager (leader-elected) + mkcert locally | Standard, mature |
| Observability | OpenTelemetry SDK → OTel Collector → **Prometheus** (HA pair) + **Loki** + **Tempo** + **Grafana**; **pino** logs | All HA, dashboards-as-code |
| Secrets | External Secrets Operator + SealedSecrets + Vault-dev (local) | No secrets in git, no secrets in Helm values |
| Image policy | cosign signatures, Trivy scans, syft SBOM, sigstore policy-controller | Supply-chain baseline |
| Local K8s | **kind** via `infra/kind/{dev,ha}.yaml` | JIT, resettable, multi-node capable, CI-parity |
| Dev loop | **Tilt** against kind | Live reload, single dashboard |
| CI | **GitHub Actions** + Turborepo remote cache + GHA caches | Matches SCM |
| Release | **release-please** per app + Helm charts to OCI (GHCR) | Automated semver from conventional commits |
| DX | **Biome** (lint+format), **Lefthook** (git hooks), **Commitlint**, **Renovate**, **mise** (tool versions) | Single binaries, Rust-fast |

### Explicitly deferred

- **Service mesh** (Linkerd/Istio) — YAGNI until mTLS or advanced retries demand it (likely P6).
- **Polyglot services** (Go controllers) — out until K8s operator work in P3/P4 clearly justifies it.
- **Event-sourced CQRS** — events are published via transactional outbox; graduating any aggregate to event-sourcing is a later architectural choice.

---

## 4. Architecture Approach — Classical Microservices (Hybrid Sync + Async)

Each bounded context is its own microservice with its own Postgres schema. UI reads go through sync gRPC/REST. Side effects and cross-service state changes go over NATS JetStream events. This is option **A** of the three we evaluated (vs. K8s-native CRD-based and Event-Sourced CQRS) — it balances strong bounded contexts, HA via replication, and minimal solo-dev complexity.

### Services (Project 1)

1. **web** — Next.js 15 portal (stateless, HA ≥2)
2. **gateway-svc** — Fastify BFF + WebSocket broker (stateless, sessions in Dragonfly, HA ≥2)
3. **identity-svc** — OIDC + user/team (Postgres, HA ≥2)
4. **catalog-svc** — service registry (Postgres, HA ≥2) — *core domain of P1*
5. **cluster-svc** — cluster registry stub (Postgres, HA ≥2; fully fleshed in P4)
6. **notification-svc** — NATS → WebSocket/SSE fan-out (Dragonfly for routing map, HA ≥2)

### Platform infra (run alongside, shared)

Postgres (CNPG 3-node), NATS JetStream (3-node), Dragonfly (3-node), Dex (2-node stateless), OTel Collector, Prometheus (HA pair), Loki, Tempo, Grafana, ingress-nginx, cert-manager, External Secrets Operator, SealedSecrets.

### Traffic flow

```
Browser
  └─HTTPS─> ingress-nginx (HA)
             ├─> web (Next.js)               # RSC fetches gateway-svc over internal DNS
             └─> gateway-svc (Fastify BFF)
                   ├─gRPC─> identity-svc ─> Postgres, Dex
                   ├─gRPC─> catalog-svc  ─> Postgres
                   ├─gRPC─> cluster-svc  ─> Postgres
                   ├─WS proxy─> notification-svc ─> Dragonfly, NATS sub
                   └─Dragonfly (sessions)

All domain services publish events to NATS JetStream via transactional outbox.
notification-svc subscribes to idp.> and fans events out to connected browsers.
All services export OTel traces/metrics/logs to the collector → Prom/Loki/Tempo/Grafana.
```

### Boundary rules (non-negotiable)

1. No service reads another service's Postgres schema directly — only via gRPC or NATS events.
2. Every NATS event has a Zod-validated schema in `packages/events/`.
3. Every gRPC service has a `.proto` in `packages/contracts/proto/` — code-generated clients, no hand-written stubs.
4. Every service exposes `/healthz`, `/readyz`, `/metrics`.
5. All writes that change domain state publish a NATS event in the same SQL transaction (transactional outbox pattern).

---

## 5. Monorepo Layout

```
lw-idp/
├── apps/                           # deployable services — each independently buildable + dockerized
│   ├── web/                        # Next.js 15 portal
│   ├── gateway-svc/                # Fastify BFF + WebSocket broker
│   ├── identity-svc/               # OIDC + user/profile store
│   ├── catalog-svc/                # Service registry (entity, owner, type, deps)
│   ├── cluster-svc/                # Cluster registry (stub in P1; full in P4)
│   └── notification-svc/           # NATS → WebSocket/SSE fan-out
│
├── packages/                       # shared libraries — never deployed, imported by apps/*
│   ├── contracts/                  # .proto + OpenAPI + codegen outputs (TS clients/servers, adapters)
│   ├── ui/                         # shadcn/ui components, design tokens, Tailwind preset
│   ├── db/                         # Drizzle schemas, migrations, testcontainers helpers
│   ├── events/                     # NATS subjects, Zod-validated event schemas, outbox impl
│   ├── auth/                       # Session + JWT + RBAC guard helpers
│   ├── telemetry/                  # OTel SDK bootstrap, pino logger, tracer
│   ├── testing/                    # Test utilities: fixtures, testcontainers, msw handlers, chaos harness
│   ├── errors/                     # Typed error hierarchy + HTTP/gRPC mappers
│   └── config/                     # Shared tsconfig, biome config, turbo pipeline fragments
│
├── charts/                         # Helm charts — one per deployable service, plus umbrella
│   ├── lw-idp/                     # umbrella chart composing all service charts
│   ├── web/
│   ├── gateway-svc/
│   ├── identity-svc/
│   ├── catalog-svc/
│   ├── cluster-svc/
│   └── notification-svc/
│
├── infra/                          # non-Helm K8s manifests (operators, CRs, overlays)
│   ├── kind/                       # dev.yaml, ha.yaml — cluster profiles
│   ├── kustomize/                  # env overlays: local / dev / stage / prod
│   ├── cnpg/                       # CloudNativePG operator + Cluster CR
│   ├── nats/                       # NATS JetStream operator + StreamConfig
│   ├── dex/                        # Dex OIDC config + GitHub connector
│   ├── observability/              # kube-prometheus-stack, Loki, Tempo, Grafana values & dashboards
│   ├── dragonfly/                  # Dragonfly (or Redis Sentinel) values
│   └── ingress/                    # ingress-nginx + cert-manager
│
├── scripts/                        # bootstrap + dev automation (all idempotent)
│   ├── cluster-up.sh               # [dev|ha] — kind + local registry up
│   ├── cluster-bootstrap.sh        # [dev|ha] — install pinned operators/charts via helmfile
│   ├── cluster-down.sh             # [dev|ha|all] — delete kind clusters
│   ├── cluster-reset.sh            # [dev|ha] — down → up → bootstrap in one go
│   ├── cluster-doctor.sh           # read-only diagnostics
│   ├── cluster-nuke.sh             # destructive: clusters + registry + caches
│   ├── codegen.sh                  # proto + OpenAPI codegen
│   └── seed-dev-data.ts            # seed catalog/cluster/user records
│
├── docs/
│   ├── adr/                        # Architecture Decision Records (numbered)
│   ├── runbooks/                   # On-call procedures per service
│   └── superpowers/specs/          # this file + future sub-project specs
│
├── .github/workflows/              # CI: lint, typecheck, test, build, chart-lint, e2e, security
├── Tiltfile
├── turbo.json
├── pnpm-workspace.yaml
├── biome.json
├── tsconfig.base.json
├── lefthook.yml
├── commitlint.config.ts
├── renovate.json
├── helmfile.yaml                   # pinned operator + chart versions (bootstrap uses this)
├── CODEOWNERS
├── CLAUDE.md                       # conventions for future Claude-assisted work
├── README.md
└── .gitignore
```

### Key design choices

- **apps/ vs. packages/** — apps are deployable; packages are libraries. No `apps/` package is imported by another app.
- **`packages/contracts` is the source of truth** for `.proto` and `openapi.yaml`; all TS clients/server stubs are generated.
- **One Helm chart per service + one umbrella chart** — a service can install standalone, or the whole platform via `helm install lw-idp charts/lw-idp`.
- **Operator CRs live under `infra/`**, not in charts (they are owned by operators and don't fit chart lifecycle).
- **`CLAUDE.md` at root** codifies conventions so future AI-assisted sessions remain coherent.

---

## 6. Services In Detail

For each service: purpose, REST/gRPC surface, Postgres schema, NATS subjects. Schemas are the MVP footprint; they grow in later projects.

### 6.1 web (Next.js 15 portal)

- **Purpose:** renders the developer-facing UI; handles OIDC callback; server-side renders pages that fetch from gateway-svc.
- **Routes:**
  - `/` — landing dashboard (recent services, health summary)
  - `/services`, `/services/[slug]` — catalog list + detail
  - `/services/new` — register-existing-service form (wizard moves to P5)
  - `/services/[slug]/deployments` *(mocked P1, real P3)*
  - `/services/[slug]/pipelines` *(mocked P1, real P2)*
  - `/services/[slug]/settings`
  - `/clusters`, `/clusters/[slug]`, `/clusters/new`
  - `/teams`, `/teams/[slug]`
  - `/settings/profile`, `/settings/api-tokens`
  - `/auth/login`, `/auth/callback`, `/auth/logout`
- **Dependencies:** gateway-svc (REST) via internal DNS for RSC and via ingress for browser.

### 6.2 gateway-svc (Fastify BFF)

- **Purpose:** the single sync entry for the browser. Validates session, enriches requests, aggregates domain calls, proxies WebSockets, publishes UI-originated commands as NATS events.
- **REST API (external):**
  - `POST /api/v1/auth/login`, `/callback`, `/logout`
  - `GET/POST/PATCH/DELETE /api/v1/services/...`
  - `GET/POST/PATCH/DELETE /api/v1/clusters/...`
  - `GET /api/v1/me`, `/api/v1/teams`
  - `GET /ws/stream` — WebSocket upgrade → proxied to notification-svc
- **State:** Dragonfly for sessions (signed cookie → session lookup).
- **Talks to:** identity-svc, catalog-svc, cluster-svc (gRPC/ConnectRPC); notification-svc (WS proxy); NATS (publish command events).

### 6.3 identity-svc

- **Purpose:** OIDC integration via Dex, user profile + team membership, token verification for other services.
- **Postgres schema:**
  - `users (id uuid pk, subject text unique, email citext, display_name, avatar_url, created_at timestamptz)`
  - `teams (id uuid pk, slug citext unique, name, created_at timestamptz)`
  - `team_memberships (team_id fk, user_id fk, role enum[owner|maintainer|member], pk(team_id,user_id))`
  - `user_sessions (id, user_id fk, refresh_token_hash, expires_at)` (only if we keep server-side refresh)
  - `outbox (id, aggregate, event_type, payload jsonb, created_at, published_at)`
- **gRPC:** `VerifyToken, GetUser, ListUsers, CreateTeam, AddTeamMember, ListTeams, GetMyTeams`.
- **NATS publishes:** `idp.identity.user.created`, `idp.identity.team.created`, `idp.identity.team.member.added`.

### 6.4 catalog-svc

- **Purpose:** authoritative registry of services in the org — ownership, type, tags, dependencies, arbitrary metadata, lightweight search.
- **Postgres schema:**
  - `services (id uuid pk, slug citext unique, name, description, type enum[service|library|website|ml|job], lifecycle enum[experimental|production|deprecated], owner_team_id fk, repo_url, created_at, updated_at)`
  - `service_tags (service_id fk, tag citext, pk(service_id, tag))` with GIN index on tag
  - `service_dependencies (service_id fk, depends_on_service_id fk, kind enum[uses|provides|consumes])`
  - `service_metadata (service_id fk, key, value_json jsonb)`
  - `outbox (...)` (as above)
- **gRPC:** `CreateService, UpdateService, DeleteService, GetService, ListServices (filter+paginate), SearchServices (FTS), AddDependency, RemoveDependency`.
- **NATS publishes:** `idp.catalog.service.created|updated|deleted`.

### 6.5 cluster-svc (P1 stub)

- **Purpose:** registry of managed K8s clusters. P1: CRUD + metadata only. P4: kubeconfig handling, live health, target-selection policies.
- **Postgres schema (P1):**
  - `clusters (id uuid pk, slug citext unique, name, environment enum[dev|stage|prod], region, provider enum[docker-desktop|eks|gke|aks|kind|other], api_endpoint, created_at)`
  - `cluster_tags (cluster_id fk, tag citext, pk(cluster_id, tag))`
  - `outbox (...)`
- **gRPC:** `RegisterCluster, UpdateCluster, DeregisterCluster, GetCluster, ListClusters`.
- **NATS publishes:** `idp.cluster.cluster.registered|updated|deregistered`.

### 6.6 notification-svc

- **Purpose:** bridges NATS events to connected browsers via WebSocket (SSE fallback). Filters per-user / per-team so UIs only receive events they are authorized for.
- **State:** Dragonfly for sticky-routing map (which replica holds a given user's WS); no Postgres.
- **NATS subscribes:** `idp.>` (wildcard) — durable consumer group per replica.
- **Outbound frames:** `{ type, entity, action, payload, ts, traceId }`.
- **Auth:** WS client presents session cookie + short-lived WS token; notification-svc validates with identity-svc and filters events against the user's team memberships.

---

## 7. API Contracts, Auth Flow, Event Bus

### 7.1 Auth flow — OIDC Authorization Code + PKCE (summary)

```
Browser → web (401) → /auth/login → gateway-svc (store PKCE verifier)
gateway-svc → Dex (code_challenge) → GitHub → user consent
GitHub → Dex (auth code) → browser → gateway-svc /auth/callback?code
gateway-svc → Dex /token (verifier) → id_token + refresh_token
gateway-svc → identity-svc.VerifyToken → upsert user, return user_id + claims
gateway-svc → Dragonfly SET session:{sid} → {user_id, exp, refresh}
gateway-svc → browser: Set-Cookie: lw-sid=… (HttpOnly, Secure, SameSite=Lax, 8h sliding)
Subsequent requests: browser cookie → gateway-svc → Dragonfly GET session → proxy to domain service over gRPC with service-to-service token
```

- Dex is a broker; additional IdPs (Google, SAML, LDAP) are added via Dex connectors without touching services.
- Browser never sees JWTs (XSS-safe).
- Service-to-service gRPC calls carry a short-lived signed token validated by identity-svc (transport is ordinary TCP in P1; mTLS via Linkerd lands in P6).

### 7.2 REST contract — OpenAPI-first

- Spec lives in `packages/contracts/openapi/gateway.yaml`, URL-versioned (`/api/v1`).
- `@fastify/swagger` wires the spec into Fastify handlers; request validation is automatic.
- Client: `openapi-typescript` → TS types; `openapi-fetch` in the browser, used by TanStack Query hooks.
- Lint: `redocly lint` + `oasdiff` breaking-change check in CI.
- Versioning rule (ADR-002): additive changes only within a major version; breaking changes require a new major.

### 7.3 gRPC contract — Protobuf + ConnectRPC

- `.proto` files live in `packages/contracts/proto/{service}/v{n}/*.proto`.
- `buf` for `buf lint` and `buf breaking` in CI.
- Code generation uses `@bufbuild/protobuf` + `@connectrpc/connect-node`; outputs checked into `packages/contracts/dist/` so apps just import them.
- Service stubs and clients are always generated — never hand-written.

### 7.4 NATS JetStream — subject naming & envelope

- **Subject pattern:** `idp.{domain}.{entity}.{action}` (e.g., `idp.catalog.service.created`, `idp.identity.team.member.added`).
- **Streams:**
  - `IDP_DOMAIN` — subjects `idp.>`, retention `limits`, max-age 14d, replicas 3
  - `IDP_AUDIT` — subjects `idp.audit.>`, retention `limits`, max-age 1y, replicas 3
- **Envelope** (CloudEvents 1.0 compatible, Zod-validated in `packages/events`):

```ts
{
  id: "01HXYZ...",          // ULID
  specVersion: "1.0",
  source: "catalog-svc",
  type: "idp.catalog.service.created",
  time: "2026-04-20T...",
  traceId: "abc123...",      // propagated from OTel context
  actor: { userId, teamId },
  data: { ...zod-validated payload... }
}
```

### 7.5 Transactional outbox

Every write service owns an `outbox` table; domain-write + outbox-insert occur in one SQL transaction. A background publisher (internal to each service) polls `published_at IS NULL`, publishes to NATS, marks the row, ACKs JetStream. Consumers dedupe by `envelope.id`. Shared implementation in `packages/events/outbox.ts`.

### 7.6 Authorization (Project 1 baseline)

Coarse checks at gateway-svc, fine-grained re-checks at domain services. Policy is code in `packages/auth/` for P1; P6 moves to Casbin or OPA.

- Authenticated users can **read** catalog + cluster lists.
- **Create/update/delete service** requires membership in `ownerTeam` with role ≥ `maintainer`.
- **Create/update/delete cluster** requires membership in the built-in `platform-admins` team.
- Team CRUD requires `platform-admins`.

---

## 8. HA / No Single Point of Failure

### 8.1 Tier-by-tier

| Component | Replicas | Strategy | Mitigation of single-replica loss |
|---|---|---|---|
| ingress-nginx | 2+ | Deployment + topologySpreadConstraints + HPA min=2 | PDB min-available=1; node drain is safe |
| cert-manager | 2 | Leader-elected via K8s Leases | Standby takes over instantly |
| web | 2+ | Stateless; rollingUpdate maxSurge=25% maxUnavailable=0 | Zero-downtime rollouts |
| gateway-svc | 2+ | Stateless; sessions in Dragonfly; `Idempotency-Key` on unsafe writes | Client retry safe |
| identity-svc / catalog-svc / cluster-svc | 2+ | Stateless app; all state in Postgres | gRPC client retry + circuit breaker via ConnectRPC interceptors |
| notification-svc | 2+ | Stateful WS; durable NATS consumers | Client auto-reconnect with `last-event-id`; consumer resumes |
| PostgreSQL | 3 | CloudNativePG: 1 primary + 2 hot standbys, streaming replication, automated failover | Promotion < 10s; apps reconnect via `*-rw` Service endpoint; no data loss (sync replica) |
| NATS JetStream | 3 | Raft-backed clustered streams, `replicas=3` per stream | Leader re-election; durable consumer state replicated |
| Dragonfly | 3 | Dragonfly Operator HA (or Redis Sentinel 3-node) | Auto failover, sentinel-aware clients |
| Dex | 2 | Stateless broker | Client retry |
| OTel Collector | DaemonSet agents + HA gateway pair | Agents buffer/retry | Dropped spans logged as metric |
| Prometheus | 2 (HA pair) | Independent scrapers, same config | Grafana queries both |
| Loki / Tempo | SimpleScalable, 2+ per component | Ring replication factor 2; S3-compatible storage (MinIO local) | Pod crash tolerated |
| Grafana | 2 | Stateless + shared Postgres backend | Ingress load-balances |

### 8.2 K8s primitives baked into every workload chart

- `replicas ≥ 2` (default 2, tunable per-service via values)
- `rollingUpdate: maxSurge=25%, maxUnavailable=0`
- `topologySpreadConstraints: maxSkew 1 on kubernetes.io/hostname` (ScheduleAnyway locally, DoNotSchedule on HA profile)
- `podAntiAffinity.preferredDuringSchedulingIgnoredDuringExecution`
- `readinessProbe` + `livenessProbe` + `startupProbe` on `/healthz` / `/readyz`
- `resources.requests` and `resources.limits` — mandatory, not optional
- `lifecycle.preStop: sleep 5` for graceful connection drain
- `PodDisruptionBudget minAvailable=1`

### 8.3 Failure-scenario walkthroughs

| Scenario | What happens | User-visible impact |
|---|---|---|
| Single app-service pod crash | K8s restarts; another replica serves traffic | None |
| Rolling deploy of catalog-svc | `maxUnavailable=0` keeps a ready replica at every step | None |
| Postgres primary lost | CNPG promotes a standby in ~10s; apps reconnect via `*-rw` endpoint | ~5–15s write-latency spike, no data loss |
| NATS node lost | Raft re-elects leader; durable consumers resume from last ack | < 2s publish/consume pause |
| K8s node drain | PDB + anti-affinity keep replicas on other nodes; evicted pods reschedule | None |
| Ingress controller crash | Second replica serves all traffic | None (TCP retry) |
| Dex down during login | Existing sessions keep working; new logins fail until recovery | Partial — only new logins blocked |

### 8.4 Docker Desktop caveat → solved by kind-ha

Docker Desktop runs a single K8s node, so true multi-node failure can't be tested on its built-in cluster. We use kind instead: `lw-idp-dev` (1 control-plane + 1 worker, fast dev loop) and `lw-idp-ha` (1 control-plane + 3 workers, for HA + chaos tests). Same charts target both; CI runs the HA suite against `lw-idp-ha` on every PR.

### 8.5 Chaos & HA test suite

- `packages/testing/chaos/` — Playwright-driven disruptions using **chaos-mesh** (pod kill, network partition, DB failover) while asserting zero 5xx on a hot path.
- **Light HA smoke** (rolling deploy + pod kill on app tier) runs on every PR that touches `charts/` or `apps/` — PR-blocking, ~4 min.
- **Full chaos suite** (network partitions, DB failover, NATS node loss) runs nightly and on release branches.
- **k6 soak** (nightly): 500 RPS sustained for 30 min with random restarts; assert < 0.01% error rate.

---

## 9. Local Development (kind, JIT, resettable)

### 9.1 Cluster profiles — `infra/kind/`

| Profile | Nodes | Purpose |
|---|---|---|
| `lw-idp-dev` | 1 control-plane + 1 worker | Fast iteration; Tilt targets this |
| `lw-idp-ha` | 1 control-plane + 3 workers | Real HA + chaos testing; matches CI |

Both profiles expose container ports 80/443, wire a local image registry (`kind-registry` container on port 5001), and pin CNI/kubelet args.

### 9.2 Scripts (all idempotent)

| Script | Behaviour |
|---|---|
| `scripts/cluster-up.sh [dev|ha]` | Ensure Docker; create kind cluster if missing; create/wire local registry; set kubectx |
| `scripts/cluster-bootstrap.sh [dev|ha]` | `helmfile sync` — installs pinned operators/charts in dependency order (cert-manager → ingress-nginx → CNPG → NATS → Dex → Dragonfly → kube-prometheus-stack → Loki → Tempo → Grafana); applies CRs; seeds dev data |
| `scripts/cluster-down.sh [dev|ha|all]` | Delete kind cluster(s); keep registry warm |
| `scripts/cluster-reset.sh [dev|ha]` | Down → Up → Bootstrap in one command (~2 min on Apple Silicon) |
| `scripts/cluster-doctor.sh` | Read-only diagnostics (kubectx, operator readiness, PVCs, ingress, DNS) |
| `scripts/cluster-nuke.sh` | Destructive escape hatch: clusters + registry + image cache (y/N prompt) |

### 9.3 Tooling

- **mise** pins kind, kubectl, helm, tilt, node, pnpm, buf, k6, chaos-mesh-cli via `.tool-versions`.
- **helmfile** (`infra/helmfile.yaml`) declares every operator + chart version; bootstrap scripts call `helmfile sync`.
- **Tilt** watches `apps/*`, rebuilds images into the kind-local registry, redeploys via Helm, shows logs — one `tilt up` for the whole platform.
- **mkcert** issues locally trusted TLS for `*.lw-idp.local`; bootstrap writes hosts entries.
- **k9s** / **stern** optional for dev UX.
- **chaos-mesh** installed only in the `ha` profile.

### 9.4 Daily flow

```bash
# one-time per machine
brew install docker mise mkcert
mise install                   # installs kind, kubectl, helm, tilt, node, pnpm, buf
mkcert -install

# daily
pnpm install
./scripts/cluster-up.sh dev
./scripts/cluster-bootstrap.sh dev
tilt up                        # live-reload everything

# reset when things feel weird
./scripts/cluster-reset.sh dev   # ~2 min

# HA work
./scripts/cluster-up.sh ha
./scripts/cluster-bootstrap.sh ha
pnpm test:ha
./scripts/cluster-down.sh ha
```

### 9.5 CI parity

GitHub Actions uses `helm/kind-action` with the **same** `infra/kind/*.yaml` profiles. Jobs: `test-unit` (no cluster), `test-integration` (kind dev), `test-ha` (kind ha + chaos-mesh), `e2e` (Playwright on kind dev). Image builds cached via `docker/build-push-action` + GHA cache; on failure, a tarball of `kubectl cluster-info dump` + logs is uploaded as an artifact.

---

## 10. Frontend (Portal)

### 10.1 Route tree — Next.js 15 App Router

```
apps/web/src/app/
├── (marketing)/                  # public; optional landing
│   └── page.tsx
├── (app)/                        # app shell group — requires session
│   ├── layout.tsx                # sidebar + topbar + WebSocket context + toasts
│   ├── page.tsx                  # / dashboard
│   ├── services/
│   │   ├── page.tsx              # list + filter + search
│   │   ├── new/page.tsx          # register form (P1; wizard in P5)
│   │   └── [slug]/
│   │       ├── page.tsx
│   │       ├── deployments/      # mocked P1, real P3
│   │       ├── pipelines/        # mocked P1, real P2
│   │       └── settings/
│   ├── clusters/{page.tsx, new/page.tsx, [slug]/page.tsx}
│   ├── teams/{page.tsx, [slug]/page.tsx}
│   └── settings/{profile/page.tsx, api-tokens/page.tsx}
├── auth/
│   ├── login/page.tsx
│   ├── callback/route.ts         # POSTs code to gateway, sets cookie
│   └── logout/route.ts
├── api/stream/route.ts           # SSE bridge to notification-svc
├── layout.tsx                    # <html>, theme, fonts
├── error.tsx  not-found.tsx  loading.tsx  global-error.tsx
└── middleware.ts                 # session cookie check + redirect
```

### 10.2 Component stack

- `@lw-idp/ui` wraps **shadcn/ui** (Radix primitives + Tailwind) — components live in `packages/ui/`, we own them.
- **Tailwind CSS v4** with CSS-first config; design tokens as CSS variables with dark-mode built in.
- **TanStack Query v5** for client data; RSC fetch for server data; `openapi-fetch` for type-safe clients.
- **TanStack Table v8**, **react-hook-form** + **Zod** resolvers sharing schemas from `packages/contracts`.
- **Zustand** for minimal client state (theme, user, pending UI-only flags); TanStack Query owns server state.
- Real-time: a single `EventStreamProvider` opens the WS to `/ws/stream`; incoming events invalidate targeted queries.
- **axe-playwright** runs on every key page in CI — zero violations is a gate.
- **next-intl** scaffolded (en-only in P1).
- **cmdk** command palette (`⌘K`) from day 1; **sonner** toasts; **lucide-react** icons.

### 10.3 RSC-vs-Client rule

- Default to Server Components. Pages + layouts are RSC, fetching through server-side `openapi-fetch` against internal DNS.
- Client Components only for: forms, interactive tables, WS provider, charts, anything with state or effects. Named `*.client.tsx`.
- Server Actions used for mutations that don't need an SDK; otherwise use the generated client through TanStack Query.

### 10.4 Mock-data strategy — adapter pattern + MSW

Domain data (services, clusters, users, teams) is **always real**. Integration data (deploys, pipelines, git status) goes through an **adapter interface** with a mock implementation in P1 and real implementations in P2–P5.

```ts
// packages/contracts/ts/adapters/deployments.ts
export interface DeploymentAdapter {
  list(serviceSlug: string): Promise<Deployment[]>;
  get(id: string): Promise<Deployment>;
  trigger(serviceSlug: string, opts: TriggerOpts): Promise<Deployment>;
}

// apps/web/src/lib/adapters.ts
export const deployments: DeploymentAdapter =
  process.env.NEXT_PUBLIC_INTEG_DEPLOYMENTS === "mock"
    ? new MockDeploymentAdapter()
    : new ArgoDeploymentAdapter(); // exists from P3 onward
```

- **MSW** drives dev (browser), Storybook, and Playwright (Node mode) from shared fixtures in `packages/testing/fixtures/`.
- Storybook: every shadcn-wrapped component has a story + play test.

### 10.5 UX baseline

- Dark mode default, light available, toggle in Settings.
- Fonts: **Inter** (UI) + **JetBrains Mono** (code), self-hosted via `next/font`.
- Loading states = content-shaped skeletons (no spinners).
- Empty states are actionable CTAs ("Register your first service").
- Error boundaries per route group; 404 + 500 custom pages.

---

## 11. Testing, Observability, Security, CI/CD

### 11.1 Testing pyramid

| Layer | Tool | Scope | Gate |
|---|---|---|---|
| Unit | Vitest + Testing Library | Pure functions, isolated components, adapters with MSW | PR-blocking; changed-file coverage ≥ 80% |
| Integration | Vitest + **testcontainers-node** | Real Postgres + NATS + Dragonfly; DAO, outbox, consumers | PR-blocking |
| Contract | **Pact** + `buf breaking` + `oasdiff` | gRPC + REST providers vs. consumers | PR-blocking when `packages/contracts` changes |
| Component | Storybook + play tests | Components in isolation with MSW | PR-blocking |
| E2E | **Playwright** on kind-dev | Golden paths: login, create service, register cluster, receive WS event | PR-blocking |
| Accessibility | **axe-playwright** | Zero violations on major pages | PR-blocking |
| Load / soak | **k6** | 500 RPS × 30 min on gateway-svc; p95 < 100ms, error < 0.1% | Nightly |
| HA smoke | **chaos-mesh** on kind-ha | Pod-kill + rolling-deploy against live traffic, assert zero 5xx | PR-blocking when `charts/` or `apps/` change |
| Full chaos | **chaos-mesh** on kind-ha | Network partition, DB failover, NATS node loss | Nightly + release branches |

Speed budget: local unit + integration under 2 min via Turborepo caching and `TESTCONTAINERS_REUSE_ENABLE=true`.

### 11.2 Observability

- `packages/telemetry` bootstraps OTel in every service; auto-instrumentation for Fastify/Connect/pg/NATS.
- Logs via **pino**, auto-correlated with `trace_id`, `span_id`, `request_id`, `user_id`.
- Domain metrics: `lwidp_{svc}_{entity}_{action}_total`, etc.
- Every HTTP + gRPC call is a span; NATS publish/consume propagates trace context in message headers.
- OTel Collector (DaemonSet agent → Deployment gateway) → Prometheus (HA pair), Loki, Tempo.
- Dashboards + alert rules stored as code in `infra/observability/dashboards/` + `alerts/`.

**SLOs** tracked in Grafana with burn-rate alerts via Alertmanager:

| Service | SLI | SLO |
|---|---|---|
| gateway-svc | HTTP 2xx ratio | 99.9% rolling 30d |
| gateway-svc | p95 latency | < 200ms |
| identity/catalog/cluster-svc | gRPC success ratio | 99.95% |
| notification-svc | event→WS delivery p95 | < 500ms |
| NATS JetStream | publish-ack p99 | < 20ms |

### 11.3 Security

**Supply chain**
- Multi-arch images via `docker buildx` (amd64 + arm64).
- **syft** generates SPDX SBOMs attached to every image.
- **Trivy** scans images + IaC + secrets; HIGH/CRITICAL CVEs block merge.
- **cosign** signs every image; **sigstore policy-controller** admission controller rejects unsigned images.
- GitHub Dependency Review + Renovate auto-PRs.

**Runtime**
- Non-root containers, read-only root FS, `seccompProfile: RuntimeDefault`, no privilege escalation.
- Pod Security Admission `restricted` across all namespaces.
- **NetworkPolicies** default-deny + explicit allow per service-pair.
- mTLS between services deferred to P6 (Linkerd); P1 uses ingress TLS + in-cluster gRPC over service DNS.

**Secrets**
- **External Secrets Operator** with provider pluggability (local: **vault-dev**; prod: real Vault / AWS SM / GCP SM / 1Password).
- **SealedSecrets** as fallback for git-tracked dev secrets (e.g. Dex GitHub client id).
- `.env` gitignored; zero secrets in Helm values — all via ESO/SealedSecrets.

**Auth/Z baseline (reprise)**
- Session cookie: HttpOnly + Secure + SameSite=Lax + 8h sliding expiry.
- `Idempotency-Key` required on unsafe gateway writes; stored in Dragonfly for 24h.
- Rate limits at gateway (Fastify plugin): 60 rpm unauth / 600 rpm authed default, tunable per-route.
- CSRF via SameSite + double-submit token on forms; CORS allow-list per env.
- Audit events on all mutating actions → `idp.audit.>` stream, retained 1y.

### 11.4 CI/CD (GitHub Actions)

**PR pipeline**
```
lint           biome + tsc                               ~45s  cached
test-unit      vitest per package                         ~60s  cached
test-int       vitest + testcontainers                    ~2–3m
test-contract  pact + buf breaking + oasdiff              ~30s
build          buildx multi-arch web + services           ~2m   cached
chart-lint     helm lint + kubeconform + datree           ~20s
e2e            kind dev + Playwright + axe                ~4m
ha-smoke       kind ha + chaos-mesh (pod-kill + rolling)   ~4m   (only if charts/ or apps/ changed)
security       trivy fs + image + iac + gitleaks          ~90s
```

**Main-branch pipeline**
```
release-please  → auto version + changelog per app
build + sign    cosign + SBOM → ghcr.io
chart-release   helm push → OCI (GHCR)
kind-ha-full    full chaos suite + HA regression (~10m)
deploy-dev      ArgoCD from P3 onward (P1: kubectl apply)
```

**Nightly**: k6 soak, extended chaos, dep vuln scan.

**Branch protection:** all PR checks required; Conventional-commit title enforced by Commitlint; CODEOWNERS auto-request; squash-merge only.

**Release:** `release-please` per app drives semver from conventional commits; images tagged `{sha}`, `{semver}`, `main`; Helm charts versioned and pushed to GHCR as OCI artifacts. From P3 onward, lw-idp deploys itself via ArgoCD (dogfooding).

---

## 12. Deliverables for Project 1

When this project is "done," the repo contains:

1. All six deployable apps, Docker-built, multi-arch, signed, with charts — each with working `/healthz`, `/readyz`, `/metrics` and ≥2-replica deployments.
2. The full portal UI: every route in §10.1 rendering with real domain data and mocked integration data.
3. Platform infra running on `lw-idp-dev` and `lw-idp-ha` kind profiles — Postgres (CNPG 3-node), NATS JetStream (3-node), Dragonfly (3-node), Dex, ingress-nginx, cert-manager, observability stack, External Secrets Operator + SealedSecrets.
4. Scripts in §9.2 working end-to-end.
5. CI pipeline in §11.4 green on `main`.
6. Test suites covering §11.1 with required gates passing.
7. Dashboards + alerts committed under `infra/observability/`, SLOs in §11.2 tracked in Grafana.
8. Documentation: `README.md`, `CLAUDE.md`, ADRs for top-level choices (monorepo tooling, language, message bus, etc.), per-service runbook stubs.

## 13. Explicitly Out of Scope for Project 1

- Jenkins, ArgoCD, GitHub integrations (P2 + P3) — stubbed via mock adapter.
- Full cluster-svc (kubeconfig handling, live health, routing policies) — P4.
- Scaffolding wizard / template engine — P5.
- Casbin/OPA fine-grained RBAC, multi-tenancy, tenant isolation — P6.
- Service mesh (Linkerd) — P6 or later.
- mTLS between internal services — P6 with Linkerd.
- Visual regression (Chromatic) — optional, deferred.
- Thanos (long-term metrics) — optional, deferred.

## 14. Key Decisions & Rationale (condensed ADR bullets)

- **ADR-001 Monorepo tooling → Turborepo + pnpm.** Cheapest for a solo monorepo of ~6 apps + shared libs; great caching; ecosystem-standard.
- **ADR-002 Primary language → TypeScript end-to-end.** One toolchain; shared types through generated clients; lowest solo friction. Go revisited per-service if/when warranted (likely P3/P4 controllers).
- **ADR-003 Event bus → NATS JetStream.** Lighter than Kafka; built-in clustering via Raft; sufficient for IDP event throughput.
- **ADR-004 Database HA → CloudNativePG.** Actively maintained, Kubernetes-native, automated failover, backup integration.
- **ADR-005 Local substrate → kind over Docker Desktop K8s.** Reproducible, multi-node capable, scripted up/down/reset, CI-parity.
- **ADR-006 Auth → Dex OIDC broker.** Keeps services IdP-agnostic; GitHub for P1, SAML/LDAP/Google plug in later.
- **ADR-007 Frontend framework → Next.js 15 App Router.** RSC fits the "server-heavy, client-light" pattern; ecosystem depth.
- **ADR-008 Service-to-service → ConnectRPC.** Typed Protobuf, HTTP/2, works over gRPC *and* HTTP/1.1; `buf` governance.
- **ADR-009 Lint/format → Biome.** Single Rust binary replaces ESLint + Prettier; shaves seconds off every CI run.
- **ADR-010 Testing substrate → testcontainers + Playwright + chaos-mesh.** Real services, real K8s, real disruptions — no mocks at the boundaries.

## 15. Open Questions (non-blocking)

None. Everything required to produce an implementation plan is specified above. Questions that will arise during implementation belong in PRs and ADRs rather than this spec.

---

*End of spec.*
