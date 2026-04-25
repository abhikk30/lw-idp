import { createRedisSessionStore } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { createRedis, startServer } from "@lw-idp/service-kit";
import type { FastifyInstance } from "fastify";
import { connect as natsConnect } from "nats";
import { canUserSeeEvent } from "./authz.js";
import { loadConfig } from "./config.js";
import { envelopeToFrame } from "./frame.js";
import { registerConnectRpc } from "./grpc/plugin.js";
import { startNotificationConsumer } from "./nats/consumer.js";
import { ConnectionRegistry } from "./registry.js";
import { wsPlugin } from "./ws/plugin.js";

const env = loadConfig();

// Postgres (scaffold-only in P1.6 — no writes; migration applied so future P1.7
// ListRecent/MarkRead handlers find the schema).
const db = connect(env.PG_DSN);
if (env.RUN_MIGRATIONS === "1") {
  await runMigrations(db, { migrationsFolder: "src/db/migrations" });
}

// Single Redis client shared by SessionStore (no auto-close on store.close()).
const redis = createRedis(env.REDIS_URL);
const sessionStore = createRedisSessionStore({ client: redis });

// NATS connection used by the per-pod consumer.
const nc = await natsConnect({ servers: env.NATS_URL });

// In-memory registry of WS connections for THIS pod.
const registry = new ConnectionRegistry();

// Track the Fastify instance so callbacks (onEnvelope/onError, onShutdown)
// can log against fastify.log and onShutdown can reach the underlying WS
// server to close all live sockets with code 1012 (Service Restart).
let fastifyRef: FastifyInstance | undefined;

// Per-pod ephemeral consumer on idp.>; deliver=new, ack=none.
const consumerHandle = await startNotificationConsumer({
  nc,
  consumerNamePrefix: env.CONSUMER_NAME_PREFIX,
  onEnvelope: (envObj) => {
    for (const conn of registry.all()) {
      if (!canUserSeeEvent(conn.session, envObj)) {
        continue;
      }
      if (!conn.bucket.take()) {
        registry.recordShed();
        continue;
      }
      const frame = envelopeToFrame(envObj);
      try {
        conn.send(JSON.stringify(frame));
      } catch (err) {
        fastifyRef?.log.warn({ err }, "ws-send failed");
      }
    }
  },
  onError: (err, ctx) => {
    fastifyRef?.log.error({ err, ctx }, "nats-consumer error");
  },
});

await startServer({
  name: "notification-svc",
  port: env.PORT,
  shutdownTimeoutMs: env.SHUTDOWN_CLOSE_TIMEOUT_MS + 5_000,
  readyProbes: [
    async () => {
      const ok = consumerHandle.isHealthy();
      return ok
        ? { ok, name: "nats-consumer" }
        : { ok, name: "nats-consumer", reason: "consumer not running" };
    },
    async () => {
      const ok = redis.status === "ready";
      return ok
        ? { ok, name: "redis" }
        : { ok, name: "redis", reason: `redis status: ${redis.status}` };
    },
  ],
  register: async (fastify) => {
    fastifyRef = fastify;
    await fastify.register(wsPlugin, {
      sessionStore,
      registry,
      rateLimitPerSec: env.RATE_LIMIT_PER_SEC,
      rateLimitBurst: env.RATE_LIMIT_BURST,
    });
    await registerConnectRpc(fastify);
  },
  onShutdown: async () => {
    // 1. Stop NATS consumer first so no more inbound envelopes can race
    //    against half-closed WS sockets.
    try {
      await consumerHandle.stop();
    } catch (err) {
      fastifyRef?.log.error({ err }, "shutdown: consumer.stop");
    }

    // 2. Drain NATS (publish-side flush; we don't publish, but it tidies).
    try {
      await nc.drain();
    } catch (err) {
      fastifyRef?.log.error({ err }, "shutdown: nats.drain");
    }

    // 3. Close all live WS connections with code 1012 (Service Restart) so
    //    clients reconnect on a different replica.
    try {
      const wss = fastifyRef?.websocketServer;
      const clients = wss?.clients;
      if (clients) {
        for (const c of clients) {
          try {
            if (c.readyState === c.OPEN) {
              c.close(1012, "service-restart");
            }
          } catch {
            // ignore
          }
        }
      }
    } catch {
      // ignore — best-effort
    }

    // 4. Close session store (no-op for shared client — store does not own it).
    try {
      await sessionStore.close();
    } catch (err) {
      fastifyRef?.log.error({ err }, "shutdown: sessionStore.close");
    }

    // 5. Quit the shared Redis client last (boot owns the lifecycle).
    try {
      await redis.quit();
    } catch (err) {
      fastifyRef?.log.error({ err }, "shutdown: redis.quit");
    }
  },
});
