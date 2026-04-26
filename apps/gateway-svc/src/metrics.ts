import { Counter, register } from "prom-client";

export const idempotencyReplaysCounter = new Counter({
  name: "lwidp_gateway_idempotency_replays_total",
  help: "Number of idempotent requests that replayed a cached response",
  labelNames: ["route"] as const,
  registers: [register],
});

export const ratelimitShedCounter = new Counter({
  name: "lwidp_gateway_ratelimit_shed_total",
  help: "Number of requests rejected with 429 by the rate limiter",
  labelNames: ["route"] as const,
  registers: [register],
});

/**
 * Re-attach our service-level metrics to the global prom-client registry.
 *
 * `fastify-metrics` calls `register.clear()` during plugin init (via
 * `clearRegisterOnInit: true`), which wipes ALL previously-registered
 * collectors — including ours — from the registry's `_metrics` map. The
 * Counter instances themselves still exist, but they are no longer reachable
 * via `register.metrics()`. Calling this helper after `buildServer()` returns
 * (i.e., from inside the `register: async (fastify) => { ... }` callback)
 * re-attaches our counters so the `/metrics` endpoint exposes them.
 *
 * `registerMetric` is idempotent for the same instance.
 */
export function ensureGatewayMetricsRegistered(): void {
  register.registerMetric(idempotencyReplaysCounter);
  register.registerMetric(ratelimitShedCounter);
}
