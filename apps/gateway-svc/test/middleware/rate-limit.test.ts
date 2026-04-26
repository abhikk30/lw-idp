import {
  type SessionRecord,
  type SessionStore,
  type SessionStoreSetOptions,
  serializeSessionCookie,
} from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type RedisHandle, startRedis } from "@lw-idp/testing";
import { Redis } from "ioredis";
import { register } from "prom-client";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ratelimitShedCounter } from "../../src/metrics.js";
import { rateLimitPlugin } from "../../src/middleware/rate-limit.js";
import { sessionPlugin } from "../../src/middleware/session.js";

function memorySession(): SessionStore {
  const m = new Map<string, SessionRecord>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v, _o: SessionStoreSetOptions) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async close() {
      m.clear();
    },
  };
}

describe("rate-limit plugin", () => {
  let redisHandle: RedisHandle;
  let redisClient: Redis;
  let server: LwIdpServer | undefined;

  beforeAll(async () => {
    redisHandle = await startRedis();
    redisClient = new Redis(redisHandle.url);
  }, 90_000);

  afterAll(async () => {
    await redisClient?.quit();
    await redisHandle?.stop();
  });

  afterEach(async () => {
    await server?.close();
    server = undefined;
    await redisClient.flushall();
  });

  it("returns 429 after exceeding max for an authenticated user", async () => {
    const sessionStore = memorySession();
    const rec: SessionRecord = {
      userId: "u_rl",
      email: "u@x",
      displayName: "U",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_rl", rec, { ttlSeconds: 60 });

    server = await buildServer({
      name: "gw-rl-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(rateLimitPlugin, {
          redis: redisClient,
          max: 3,
          timeWindowMs: 10_000,
        });
        fastify.get("/ping", async () => ({ pong: true }));
      },
    });

    const cookie = serializeSessionCookie("sess_rl", { secure: false, maxAgeSeconds: 60 });
    // biome-ignore lint/style/noNonNullAssertion: server is defined before hit() is called
    const hit = () => server!.fastify.inject({ method: "GET", url: "/ping", headers: { cookie } });

    for (let i = 0; i < 3; i++) {
      const r = await hit();
      expect(r.statusCode).toBe(200);
    }
    const over = await hit();
    expect(over.statusCode).toBe(429);
    expect(over.json().code).toBe("rate_limited");
  });

  it("buckets per user — different users have separate budgets", async () => {
    const sessionStore = memorySession();
    const recA: SessionRecord = {
      userId: "u_A",
      email: "a@x",
      displayName: "A",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    const recB: SessionRecord = {
      userId: "u_B",
      email: "b@x",
      displayName: "B",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_A", recA, { ttlSeconds: 60 });
    await sessionStore.set("sess_B", recB, { ttlSeconds: 60 });

    server = await buildServer({
      name: "gw-rl-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(rateLimitPlugin, {
          redis: redisClient,
          max: 2,
          timeWindowMs: 10_000,
        });
        fastify.get("/ping", async () => ({ pong: true }));
      },
    });

    const cookieA = serializeSessionCookie("sess_A", { secure: false, maxAgeSeconds: 60 });
    const cookieB = serializeSessionCookie("sess_B", { secure: false, maxAgeSeconds: 60 });

    expect(
      (await server.fastify.inject({ method: "GET", url: "/ping", headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await server.fastify.inject({ method: "GET", url: "/ping", headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(200);
    expect(
      (await server.fastify.inject({ method: "GET", url: "/ping", headers: { cookie: cookieA } }))
        .statusCode,
    ).toBe(429);
    // User B still has budget
    expect(
      (await server.fastify.inject({ method: "GET", url: "/ping", headers: { cookie: cookieB } }))
        .statusCode,
    ).toBe(200);
  });

  it("ratelimitShedCounter increments on 429", async () => {
    ratelimitShedCounter.reset();
    const sessionStore = memorySession();
    const rec: SessionRecord = {
      userId: "u_rl_metric",
      email: "m@x",
      displayName: "M",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_rlm", rec, { ttlSeconds: 60 });

    server = await buildServer({
      name: "gw-rl-metric-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(rateLimitPlugin, {
          redis: redisClient,
          max: 1,
          timeWindowMs: 10_000,
        });
        fastify.get("/ping", async () => ({ pong: true }));
      },
    });

    const cookie = serializeSessionCookie("sess_rlm", { secure: false, maxAgeSeconds: 60 });
    await server.fastify.inject({ method: "GET", url: "/ping", headers: { cookie } });
    const over = await server.fastify.inject({
      method: "GET",
      url: "/ping",
      headers: { cookie },
    });
    expect(over.statusCode).toBe(429);
    const text = await register.metrics();
    expect(text).toMatch(/lwidp_gateway_ratelimit_shed_total\{[^}]*\}/);
  });
});
