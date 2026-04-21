import { loadEnv } from "@lw-idp/service-kit";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4003),
  PG_DSN: z.string(),
  NATS_URL: z.string().default("nats://nats.nats-system.svc.cluster.local:4222"),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  RUN_MIGRATIONS: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
});

export type ClusterEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): ClusterEnv {
  return loadEnv(EnvSchema);
}
