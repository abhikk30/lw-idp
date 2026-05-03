// Side-effect preload module: starts the OpenTelemetry SDK at module-load
// time, BEFORE the importing service has a chance to require `http` or
// Fastify. Auto-instrumentations register a `require` hook that monkey-
// patches `http` when it's later required by Fastify; if OTel starts
// AFTER `http` is already loaded, the http listener creates spans but
// the exporter pipeline isn't always wired up consistently — most
// noticeably, BatchSpanProcessor's exports get dropped silently.
//
// Usage: each service's `index.ts` MUST import this file as its very
// first import:
//
//   import "@lw-idp/telemetry/preload";  // must be first
//   import { ... } from "...";
//
// Service identity comes from `OTEL_SERVICE_NAME` (set by the Helm chart).
// Falls back to `"unknown-service"` so misconfiguration is loud in Tempo
// rather than silent.
//
// Disabled when `OTEL_DISABLED=true` (tests, ad-hoc runs) or when
// `NODE_ENV=test`.

import { startOtel } from "./otel.js";

if (process.env.NODE_ENV !== "test" && process.env.OTEL_DISABLED !== "true") {
  try {
    startOtel({
      service: process.env.OTEL_SERVICE_NAME ?? "unknown-service",
      ...(process.env.OTEL_SERVICE_VERSION !== undefined
        ? { version: process.env.OTEL_SERVICE_VERSION }
        : {}),
    });
  } catch {
    // Swallow — OTel is best-effort. A missing OTLP endpoint must not
    // crash the service.
  }
}
