import { createOidcVerifier, createRedisSessionStore } from "@lw-idp/auth";
import { startServer } from "@lw-idp/service-kit";
import { Redis } from "ioredis";
import { createUpstreamClients } from "./clients/index.js";
import { loadConfig } from "./config.js";
import { authPlugin } from "./http/auth.js";
import { clustersPlugin } from "./http/clusters.js";
import { mePlugin } from "./http/me.js";
import { servicesPlugin } from "./http/services.js";
import { idempotencyPlugin } from "./middleware/idempotency.js";
import { rateLimitPlugin } from "./middleware/rate-limit.js";
import { sessionPlugin } from "./middleware/session.js";
import { createRedisStateStore } from "./services/state-store.js";

const env = loadConfig();

const redis = new Redis(env.REDIS_URL);

const sessionStore = createRedisSessionStore({ url: env.REDIS_URL });
const stateStore = createRedisStateStore({ url: env.REDIS_URL });

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

await startServer({
  name: "gateway-svc",
  port: env.PORT,
  onShutdown: async () => {
    await Promise.all([redis.quit(), sessionStore.close(), stateStore.close()]);
  },
  register: async (fastify) => {
    // Session middleware (cookie parse + session lookup) must be first
    await fastify.register(sessionPlugin, { store: sessionStore });

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
    await fastify.register(servicesPlugin, { catalogClient: clients.catalog });
    await fastify.register(clustersPlugin, { clusterClient: clients.cluster });
  },
});
