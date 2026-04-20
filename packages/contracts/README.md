# @lw-idp/contracts

Source of truth for service contracts.

- `proto/` — `.proto` definitions for gRPC services (code-generated via `buf generate` → `dist/proto/`).
- `openapi/gateway.yaml` — OpenAPI 3.1 spec for the gateway's REST surface.
- `dist/` — generated artifacts (TS clients/servers, TS types from OpenAPI). Committed for zero-install consumption by apps.

Don't hand-write gRPC clients. Import from `@lw-idp/contracts` only.
