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

  // NATS (P2.0 D3: argocd webhook receiver publishes deploy events).
  NATS_URL: z.string().default("nats://nats.nats-system.svc.cluster.local:4222"),

  // Argo CD (P2.0). The gateway proxies /api/v1/argocd/* to this URL using the
  // session's id_token as a bearer (Dex trustedPeers makes the same token
  // valid for both gateway and argocd audiences — no token-exchange needed).
  ARGOCD_API_URL: z.string().default("http://argocd-server.argocd.svc:80"),
  // Webhook receiver token (used by D3). Declared here so the env schema is
  // stable; unused in C2.
  ARGOCD_WEBHOOK_TOKEN: z.string().optional(),

  // Jenkins (P2.1.1). The gateway proxies /api/v1/jenkins/* to this URL
  // using Basic auth with a service-account API token. Empty username +
  // token means "Jenkins integration not configured" — gateway returns
  // 503 jenkins_not_configured rather than guessing or crashing.
  // See docs/runbooks/jenkins-api-token.md for the one-time setup step.
  JENKINS_API_URL: z.string().default("http://jenkins.jenkins.svc:8080"),
  JENKINS_API_USERNAME: z.string().default(""),
  JENKINS_API_TOKEN: z.string().default(""),

  // Observability (P2.2). In-cluster DNS for the Loki/Tempo/Prometheus services
  // deployed by the observability stack. PROM_URL is consumed by C2 (metrics
  // proxy) — declared here now so the env schema doesn't churn.
  LOKI_URL: z.string().default("http://loki.observability.svc.cluster.local:3100"),
  TEMPO_URL: z.string().default("http://tempo.observability.svc.cluster.local:3200"),
  PROM_URL: z
    .string()
    .default("http://kube-prometheus-stack-prometheus.observability.svc.cluster.local:9090"),
});

export type GatewayEnv = z.infer<typeof EnvSchema>;

export function loadConfig(): GatewayEnv {
  return loadEnv(EnvSchema);
}
