import { loadEnv } from "@lw-idp/service-kit";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4004),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Upstream infra
  PG_DSN: z.string().min(1),
  RUN_MIGRATIONS: z.enum(["0", "1"]).default("0"),
  REDIS_URL: z.string().default("redis://df.dragonfly-system.svc.cluster.local:6379"),
  NATS_URL: z.string().default("nats://nats.nats-system.svc.cluster.local:4222"),

  // NATS consumer
  CONSUMER_NAME_PREFIX: z.string().default("notification-svc"),

  // Operator debug knob — when "1", consumer fan-out logs
  // { type, recipients, totalConnections } at info level for each envelope.
  // Default off (silent in prod). Flip with: kubectl set env deploy/notification-svc NOTIF_DEBUG_LOG=1
  NOTIF_DEBUG_LOG: z.enum(["0", "1"]).default("0"),

  // Per-connection rate limiting (token bucket)
  RATE_LIMIT_PER_SEC: z.coerce.number().int().positive().default(100),
  RATE_LIMIT_BURST: z.coerce.number().int().positive().default(50),

  // Graceful shutdown
  SHUTDOWN_CLOSE_TIMEOUT_MS: z.coerce.number().int().positive().default(5_000),
});

export type NotificationEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): NotificationEnv {
  return loadEnv(EnvSchema);
}
