// MUST be the first import — starts OTel SDK before `http` is loaded.
import "@lw-idp/telemetry/preload";

import { createOidcVerifier, createRedisSessionStore } from "@lw-idp/auth";
import { createRedis, startServer } from "@lw-idp/service-kit";
import { connect as natsConnect } from "nats";
import { createUpstreamClients } from "./clients/index.js";
import { createK8sClient } from "./clients/k8s.js";
import { loadConfig } from "./config.js";
import { argocdPlugin } from "./http/argocd.js";
import { authPlugin } from "./http/auth.js";
import { clustersPlugin } from "./http/clusters.js";
import { importPlugin } from "./http/import.js";
import { jenkinsPlugin } from "./http/jenkins.js";
import { mePlugin } from "./http/me.js";
import { observabilityPlugin } from "./http/observability.js";
import { servicesPlugin } from "./http/services.js";
import { teamsPlugin } from "./http/teams.js";
import { argocdWebhookPlugin } from "./http/webhooks/argocd.js";
import { idempotencyPlugin } from "./middleware/idempotency.js";
import { rateLimitPlugin } from "./middleware/rate-limit.js";
import { sessionPlugin } from "./middleware/session.js";
import { createRedisStateStore } from "./services/state-store.js";

const env = loadConfig();

// NATS connection for publishing deploy events (D3: argocd webhook receiver).
// Lazy-connect: natsConnect returns once the TCP connection is established.
const nc = await natsConnect({
  servers: env.NATS_URL,
});

// Single shared Redis client for the entire process. Every consumer below
// (session store, state store, rate-limit plugin, idempotency plugin) receives
// this same client. Only this boot script is allowed to `.quit()` it.
const redis = createRedis(env.REDIS_URL);

const sessionStore = createRedisSessionStore({ client: redis });
const stateStore = createRedisStateStore({ client: redis });

const verifier = createOidcVerifier({
  issuer: env.DEX_ISSUER,
  audience: env.DEX_AUDIENCE,
  jwksPath: env.DEX_JWKS_PATH,
});

const clients = createUpstreamClients({
  identityUrl: env.IDENTITY_SVC_URL,
  catalogUrl: env.CATALOG_SVC_URL,
  clusterUrl: env.CLUSTER_SVC_URL,
});

// In-cluster Kubernetes API client for /api/v1/observability/pods. Uses the
// projected ServiceAccount token + cluster CA from the kubelet-mounted secret.
const k8sClient = createK8sClient();

await startServer({
  name: "gateway-svc",
  port: env.PORT,
  onShutdown: async () => {
    // Drain NATS (flush any buffered publishes) before closing other resources.
    try {
      await nc.drain();
    } catch {
      // ignore — already closed or never connected cleanly
    }

    // The stores hold references to the shared `redis` client but do NOT
    // own its lifecycle (see RedisSessionStoreOptions / RedisStateStoreOptions).
    // Closing them is a no-op here — we quit the single shared client exactly once.
    await Promise.all([sessionStore.close(), stateStore.close()]);
    await redis.quit();
  },
  register: async (fastify) => {
    // Session middleware (cookie parse + session lookup) must be first.
    // The webhook path is listed in publicPrefixes so that argocd-notifications
    // requests (which carry no session cookie) bypass the 401 guard.
    await fastify.register(sessionPlugin, {
      store: sessionStore,
      publicPrefixes: ["/healthz", "/readyz", "/metrics", "/auth/", "/api/v1/webhooks/argocd"],
    });

    // Rate limiting (per-user or per-IP, backed by Dragonfly)
    await fastify.register(rateLimitPlugin, {
      redis,
      max: env.RATELIMIT_MAX,
      timeWindowMs: env.RATELIMIT_WINDOW_MS,
    });

    // Idempotency-Key for mutating requests
    await fastify.register(idempotencyPlugin, {
      redis,
      ttlSeconds: env.IDEMPOTENCY_TTL_SECONDS,
    });

    // Auth routes: /auth/login, /auth/callback, /auth/logout
    await fastify.register(authPlugin, {
      verifier,
      stateStore,
      sessionStore,
      identityClient: clients.identity,
      oidc: {
        issuer: env.DEX_ISSUER,
        clientId: env.DEX_CLIENT_ID,
        clientSecret: env.DEX_CLIENT_SECRET,
        redirectUri: env.GATEWAY_REDIRECT_URI,
        scopes: ["openid", "profile", "email", "groups"],
      },
      cookie: {
        secure: env.SESSION_SECURE,
        maxAgeSeconds: env.SESSION_TTL_SECONDS,
      },
      sessionTtlSeconds: env.SESSION_TTL_SECONDS,
      defaultRedirect: "/",
    });

    // API routes
    await fastify.register(mePlugin, { identityClient: clients.identity });
    await fastify.register(teamsPlugin, { identityClient: clients.identity });
    await fastify.register(servicesPlugin, { catalogClient: clients.catalog });
    await fastify.register(clustersPlugin, { clusterClient: clients.cluster });
    // Argo CD proxy (forwards session.idToken as bearer; Dex trustedPeers
    // makes the same id_token valid for both gateway and argocd audiences).
    await fastify.register(argocdPlugin, { argocdApiUrl: env.ARGOCD_API_URL });
    // Jenkins proxy (Basic auth with service-account API token held in a Secret;
    // returns 503 jenkins_not_configured when credentials are empty).
    await fastify.register(jenkinsPlugin, {
      jenkinsApiUrl: env.JENKINS_API_URL,
      jenkinsUsername: env.JENKINS_API_USERNAME,
      jenkinsApiToken: env.JENKINS_API_TOKEN,
    });
    // Import-candidates aggregator: Argo CD apps not yet in the catalog.
    await fastify.register(importPlugin, {
      argocdApiUrl: env.ARGOCD_API_URL,
      catalogClient: clients.catalog,
    });
    // Observability proxies: /api/v1/observability/{logs,traces}.
    // Loki/Tempo are unauthenticated in-cluster; the Argo CD App lookup
    // (used to resolve a slug → its targetNamespace) reuses the session's
    // id_token as bearer.
    await fastify.register(observabilityPlugin, {
      lokiUrl: env.LOKI_URL,
      tempoUrl: env.TEMPO_URL,
      promUrl: env.PROM_URL,
      argocdApiUrl: env.ARGOCD_API_URL,
      k8sClient,
    });
    // Webhook receiver: POST /api/v1/webhooks/argocd — argocd-notifications-controller
    // posts here; we verify the bearer token and publish a CloudEvent to NATS.
    await fastify.register(argocdWebhookPlugin, {
      webhookToken: env.ARGOCD_WEBHOOK_TOKEN ?? "",
      nats: nc,
    });
  },
});
