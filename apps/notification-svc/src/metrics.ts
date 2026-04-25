import { Counter, Gauge, Histogram, register } from "prom-client";

export const fanoutHistogram = new Histogram({
  name: "lwidp_notification_fanout_seconds",
  help: "Time from envelope NATS receive to WebSocket send, per recipient",
  labelNames: ["type"] as const,
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
  registers: [register],
});

export const connectionsGauge = new Gauge({
  name: "lwidp_notification_connections",
  help: "Current number of active WebSocket connections on this pod",
  registers: [register],
});

/**
 * Increment-only counter for shed events (per-conn token bucket drained).
 * Mirrors the in-memory `registry.shedded` count but exposed for Prometheus.
 */
export const shedCounter = new Counter({
  name: "lwidp_notification_shed_total",
  help: "Frames dropped because a per-connection token bucket was empty",
  labelNames: ["type"] as const,
  registers: [register],
});

/**
 * Re-attach our service-level metrics to the global prom-client registry.
 *
 * `fastify-metrics` calls `register.clear()` during plugin init (via
 * `clearRegisterOnInit: true`), which wipes ALL previously-registered
 * collectors — including ours — from the registry's `_metrics` map. The
 * Histogram/Gauge/Counter instances themselves still exist, but they are no
 * longer reachable via `register.metrics()`. Calling this helper after
 * `buildServer()` returns (e.g., from inside the WS plugin's register fn)
 * re-attaches our metrics so the `/metrics` endpoint exposes them.
 *
 * `registerMetric` is idempotent for the same instance.
 */
export function ensureNotificationMetricsRegistered(): void {
  register.registerMetric(fanoutHistogram);
  register.registerMetric(connectionsGauge);
  register.registerMetric(shedCounter);
}
