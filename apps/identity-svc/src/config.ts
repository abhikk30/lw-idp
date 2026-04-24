import { loadEnv } from "@lw-idp/service-kit";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4001),
  PG_DSN: z.string().min(1),
  NATS_URL: z.string().default("nats://nats.nats-system.svc.cluster.local:4222"),
  OUTBOX_POLL_MS: z.coerce.number().int().positive().default(500),
  RUN_MIGRATIONS: z.string().optional(),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),
  DEX_ISSUER: z.string().min(1),
  DEX_AUDIENCE: z.string().default("lw-idp-gateway"),
});

export type IdentityEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): IdentityEnv {
  return loadEnv(EnvSchema);
}
