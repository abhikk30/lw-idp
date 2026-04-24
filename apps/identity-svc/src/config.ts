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
  DEX_CLIENT_ID: z.string().default("lw-idp-gateway"),
  DEX_CLIENT_SECRET: z.string().min(1),
  GATEWAY_REDIRECT_URI: z.string().min(1),
  SESSION_SECURE: z
    .string()
    .optional()
    .transform((s: string | undefined) => s === "true"),
});

export type IdentityEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): IdentityEnv {
  return loadEnv(EnvSchema);
}
