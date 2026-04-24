import { loadEnv } from "@lw-idp/service-kit";
import { z } from "zod";

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  LOG_LEVEL: z.enum(["debug", "info", "warn", "error"]).default("info"),

  // Upstream services (in-cluster DNS)
  IDENTITY_SVC_URL: z.string().default("http://identity-svc.lw-idp.svc.cluster.local"),
  CATALOG_SVC_URL: z.string().default("http://catalog-svc.lw-idp.svc.cluster.local"),
  CLUSTER_SVC_URL: z.string().default("http://cluster-svc.lw-idp.svc.cluster.local"),

  // Dragonfly (Redis-protocol) for session + rate-limit + idempotency-key stores
  REDIS_URL: z.string().default("redis://df.dragonfly-system.svc.cluster.local:6379"),

  // OIDC / Dex
  DEX_ISSUER: z.string().min(1),
  DEX_AUDIENCE: z.string().default("lw-idp-gateway"),
  DEX_CLIENT_ID: z.string().default("lw-idp-gateway"),
  DEX_CLIENT_SECRET: z.string().min(1),
  DEX_JWKS_PATH: z.string().default("/keys"),
  GATEWAY_REDIRECT_URI: z.string().min(1),

  // Session cookie
  SESSION_SECURE: z
    .string()
    .optional()
    .transform((s: string | undefined) => s === "true"),
  SESSION_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(8 * 60 * 60),

  // Rate limit
  RATELIMIT_MAX: z.coerce.number().int().positive().default(600),
  RATELIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),

  // Idempotency-Key
  IDEMPOTENCY_TTL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(24 * 60 * 60),
});

export type GatewayEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): GatewayEnv {
  return loadEnv(EnvSchema);
}
