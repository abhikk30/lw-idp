import {
  type SessionRecord,
  type SessionStore,
  type SessionStoreSetOptions,
  serializeSessionCookie,
} from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterEach, describe, expect, it } from "vitest";
import { sessionPlugin } from "../../src/middleware/session.js";

function memoryStore(): SessionStore {
  const m = new Map<string, SessionRecord>();
  return {
    async get(key) {
      return m.get(key);
    },
    async set(key, value, _opts: SessionStoreSetOptions) {
      m.set(key, value);
    },
    async delete(key) {
      m.delete(key);
    },
    async close() {
      m.clear();
    },
  };
}

describe("session plugin", () => {
  let server: LwIdpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  const sampleRecord: SessionRecord = {
    userId: "u_1",
    email: "alice@example.com",
    displayName: "Alice",
    teams: [{ id: "t_1", slug: "platform", name: "Platform" }],
    createdAt: new Date().toISOString(),
  };

  it("sets req.session when a valid cookie + store entry exist", async () => {
    const store = memoryStore();
    await store.set("sess_valid", sampleRecord, { ttlSeconds: 60 });

    server = await buildServer({
      name: "gw-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store });
        fastify.get("/protected", async (req) => ({ session: req.session }));
      },
    });
    const cookie = serializeSessionCookie("sess_valid", { secure: false, maxAgeSeconds: 60 });
    const res = await server.fastify.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().session).toMatchObject({ userId: "u_1", email: "alice@example.com" });
  });

  it("returns 401 on protected routes without a cookie", async () => {
    server = await buildServer({
      name: "gw-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: memoryStore() });
        fastify.get("/protected", async () => ({ ok: true }));
      },
    });
    const res = await server.fastify.inject({ method: "GET", url: "/protected" });
    expect(res.statusCode).toBe(401);
    expect(res.json().code).toBe("unauthorized");
  });

  it("returns 401 when cookie refers to an unknown session", async () => {
    server = await buildServer({
      name: "gw-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: memoryStore() });
        fastify.get("/protected", async () => ({ ok: true }));
      },
    });
    const cookie = serializeSessionCookie("sess_unknown", { secure: false, maxAgeSeconds: 60 });
    const res = await server.fastify.inject({
      method: "GET",
      url: "/protected",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(401);
  });

  it("/healthz + /readyz + /auth/* are public and pass without cookie", async () => {
    server = await buildServer({
      name: "gw-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: memoryStore() });
        fastify.get("/auth/login", async () => ({ ok: true }));
      },
    });
    for (const url of ["/healthz", "/readyz", "/auth/login"]) {
      const res = await server.fastify.inject({ method: "GET", url });
      expect(res.statusCode).toBe(200);
    }
  });

  it("populates session on public paths when cookie is present (used by /auth/logout)", async () => {
    const store = memoryStore();
    await store.set("sess_pub", sampleRecord, { ttlSeconds: 60 });
    server = await buildServer({
      name: "gw-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store });
        fastify.get("/auth/whoami", async (req) => ({ session: req.session }));
      },
    });
    const cookie = serializeSessionCookie("sess_pub", { secure: false, maxAgeSeconds: 60 });
    const res = await server.fastify.inject({
      method: "GET",
      url: "/auth/whoami",
      headers: { cookie },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().session?.userId).toBe("u_1");
  });
});
