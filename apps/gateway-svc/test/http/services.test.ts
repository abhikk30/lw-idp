import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc as registerCatalogConnectRpc } from "../../../catalog-svc/src/grpc/plugin.js";
import { createCatalogClient } from "../../src/clients/catalog.js";
import { servicesPlugin } from "../../src/http/services.js";
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

describe("gateway /api/v1/services", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let catalogServer: LwIdpServer;
  let gateway: LwIdpServer;
  let gatewayUrl: string;

  beforeAll(async () => {
    // 1. Postgres + catalog-svc migrations
    pg = await startPostgres({ database: "gateway_services_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../catalog-svc/src/db/migrations" });

    // 2. Catalog-svc in-process
    catalogServer = await buildServer({
      name: "catalog-svc",
      port: 0,
      register: async (fastify) => {
        await registerCatalogConnectRpc(fastify, { db });
      },
    });
    const cAddr = await catalogServer.listen();
    const catalogUrl = (typeof cAddr === "string" ? cAddr : `http://127.0.0.1:${cAddr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );

    // 3. Gateway with sessionPlugin + servicesPlugin
    const catalogClient = createCatalogClient(catalogUrl);
    const sessionStore = memorySession();
    const sessionRecord: SessionRecord = {
      userId: "u_svc_test",
      email: "svc@test.com",
      displayName: "Svc User",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_svc_test", sessionRecord, { ttlSeconds: 3600 });

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(servicesPlugin, { catalogClient });
      },
    });
    const gAddr = await gateway.listen();
    gatewayUrl = (typeof gAddr === "string" ? gAddr : `http://127.0.0.1:${gAddr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 120_000);

  afterAll(async () => {
    await gateway?.close();
    await catalogServer?.close();
    await pg?.stop();
  });

  const authed = {
    headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
  };

  it("POST /api/v1/services creates a service (201)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/services`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gw-svc-1",
        name: "GW Service 1",
        description: "test",
        type: "service",
        lifecycle: "production",
        tags: ["gateway", "test"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; lifecycle: string; type: string };
    expect(body.slug).toBe("gw-svc-1");
    expect(body.lifecycle).toBe("production");
    expect(body.type).toBe("service");
  });

  it("GET /api/v1/services lists created service", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/services`, authed);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ slug: string }> };
    expect(body.items.some((s) => s.slug === "gw-svc-1")).toBe(true);
  });

  it("GET /api/v1/services/:id returns service", async () => {
    // First create a known service
    const createRes = await fetch(`${gatewayUrl}/api/v1/services`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
      body: JSON.stringify({ slug: "gw-svc-2", name: "GW Service 2", type: "library" }),
    });
    const created = (await createRes.json()) as { id: string; slug: string };

    const res = await fetch(`${gatewayUrl}/api/v1/services/${created.id}`, authed);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string };
    expect(body.id).toBe(created.id);
    expect(body.slug).toBe("gw-svc-2");
  });

  it("PATCH /api/v1/services/:id updates name", async () => {
    const createRes = await fetch(`${gatewayUrl}/api/v1/services`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
      body: JSON.stringify({ slug: "gw-svc-patch", name: "Original", type: "service" }),
    });
    const created = (await createRes.json()) as { id: string };

    const patchRes = await fetch(`${gatewayUrl}/api/v1/services/${created.id}`, {
      method: "PATCH",
      headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated Name" }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as { name: string };
    expect(updated.name).toBe("Updated Name");
  });

  it("DELETE /api/v1/services/:id returns 204, GET returns 404", async () => {
    const createRes = await fetch(`${gatewayUrl}/api/v1/services`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_svc_test", "content-type": "application/json" },
      body: JSON.stringify({ slug: "gw-svc-del", name: "To Delete", type: "service" }),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${gatewayUrl}/api/v1/services/${created.id}`, {
      method: "DELETE",
      headers: { cookie: "lw-sid=sess_svc_test" },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${gatewayUrl}/api/v1/services/${created.id}`, authed);
    expect(getRes.status).toBe(404);
  });

  it("GET /api/v1/services/:id for unknown id returns 404", async () => {
    const res = await fetch(
      `${gatewayUrl}/api/v1/services/00000000-0000-0000-0000-000000000000`,
      authed,
    );
    expect(res.status).toBe(404);
  });
});
