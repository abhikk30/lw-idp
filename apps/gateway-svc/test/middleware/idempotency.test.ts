import {
  type SessionRecord,
  type SessionStore,
  type SessionStoreSetOptions,
  serializeSessionCookie,
} from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type RedisHandle, startRedis } from "@lw-idp/testing";
import { Redis } from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { idempotencyPlugin } from "../../src/middleware/idempotency.js";
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

describe("idempotency plugin", () => {
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

  function build(rec: SessionRecord, sid = "sess_idem"): Promise<LwIdpServer> {
    const sessionStore = memorySession();
    sessionStore.set(sid, rec, { ttlSeconds: 60 });
    let counter = 0;
    return buildServer({
      name: "gw-idem-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(idempotencyPlugin, { redis: redisClient, ttlSeconds: 300 });
        fastify.post("/resource", async (req, reply) => {
          counter++;
          return reply.code(201).send({ id: String(counter), body: req.body });
        });
      },
    });
  }

  const rec: SessionRecord = {
    userId: "u_idem",
    email: "i@x",
    displayName: "I",
    teams: [],
    createdAt: new Date().toISOString(),
  };
  const cookie = serializeSessionCookie("sess_idem", { secure: false, maxAgeSeconds: 60 });

  it("replays the stored response on second call with same key + body", async () => {
    server = await build(rec);
    const headers = { cookie, "content-type": "application/json", "idempotency-key": "abc-1" };
    const r1 = await server.fastify.inject({
      method: "POST",
      url: "/resource",
      headers,
      payload: { x: 1 },
    });
    const r2 = await server.fastify.inject({
      method: "POST",
      url: "/resource",
      headers,
      payload: { x: 1 },
    });
    expect(r1.statusCode).toBe(201);
    expect(r2.statusCode).toBe(201);
    expect(r1.json().id).toBe("1");
    expect(r2.json().id).toBe("1"); // replayed, not a new id
    expect(r2.headers["idempotency-replayed"]).toBe("true");
  });

  it("returns 409 on same key with different body", async () => {
    server = await build(rec);
    const headers = { cookie, "content-type": "application/json", "idempotency-key": "abc-2" };
    await server.fastify.inject({ method: "POST", url: "/resource", headers, payload: { x: 1 } });
    const conflict = await server.fastify.inject({
      method: "POST",
      url: "/resource",
      headers,
      payload: { x: 2 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().code).toBe("conflict");
  });

  it("does not interfere with GET (safe method)", async () => {
    server = await buildServer({
      name: "gw-idem-test",
      port: 0,
      register: async (fastify) => {
        const sessionStore = memorySession();
        await sessionStore.set("sess_idem", rec, { ttlSeconds: 60 });
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(idempotencyPlugin, { redis: redisClient, ttlSeconds: 300 });
        let n = 0;
        fastify.get("/count", async () => ({ n: ++n }));
      },
    });
    const headers = { cookie, "idempotency-key": "safe-key" };
    const r1 = await server.fastify.inject({ method: "GET", url: "/count", headers });
    const r2 = await server.fastify.inject({ method: "GET", url: "/count", headers });
    expect(r1.json().n).toBe(1);
    expect(r2.json().n).toBe(2); // NOT replayed
  });

  it("without Idempotency-Key header, handler runs every time", async () => {
    server = await build(rec);
    const headers = { cookie, "content-type": "application/json" };
    const r1 = await server.fastify.inject({
      method: "POST",
      url: "/resource",
      headers,
      payload: { a: 1 },
    });
    const r2 = await server.fastify.inject({
      method: "POST",
      url: "/resource",
      headers,
      payload: { a: 1 },
    });
    expect(r1.json().id).not.toBe(r2.json().id);
  });
});
