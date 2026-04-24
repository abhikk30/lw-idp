import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc as registerClusterConnectRpc } from "../../../cluster-svc/src/grpc/plugin.js";
import { createClusterClient } from "../../src/clients/cluster.js";
import { clustersPlugin } from "../../src/http/clusters.js";
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

describe("gateway /api/v1/clusters", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let clusterServer: LwIdpServer;
  let gateway: LwIdpServer;
  let gatewayUrl: string;

  beforeAll(async () => {
    // 1. Postgres + cluster-svc migrations
    pg = await startPostgres({ database: "gateway_clusters_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../cluster-svc/src/db/migrations" });

    // 2. Cluster-svc in-process
    clusterServer = await buildServer({
      name: "cluster-svc",
      port: 0,
      register: async (fastify) => {
        await registerClusterConnectRpc(fastify, { db });
      },
    });
    const cAddr = await clusterServer.listen();
    const clusterUrl = (typeof cAddr === "string" ? cAddr : `http://127.0.0.1:${cAddr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );

    // 3. Gateway with sessionPlugin + clustersPlugin
    const clusterClient = createClusterClient(clusterUrl);
    const sessionStore = memorySession();
    const sessionRecord: SessionRecord = {
      userId: "u_cluster_test",
      email: "cluster@test.com",
      displayName: "Cluster User",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_cluster_test", sessionRecord, { ttlSeconds: 3600 });

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(clustersPlugin, { clusterClient });
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
    await clusterServer?.close();
    await pg?.stop();
  });

  const authed = {
    headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
  };

  it("POST /api/v1/clusters registers a cluster (201)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/clusters`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gw-cluster-1",
        name: "GW Cluster 1",
        environment: "prod",
        region: "us-east-1",
        provider: "eks",
        tags: ["gateway", "test"],
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { slug: string; environment: string; provider: string };
    expect(body.slug).toBe("gw-cluster-1");
    expect(body.environment).toBe("prod");
    expect(body.provider).toBe("eks");
  });

  it("GET /api/v1/clusters lists created cluster", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/clusters`, authed);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ slug: string }> };
    expect(body.items.some((c) => c.slug === "gw-cluster-1")).toBe(true);
  });

  it("GET /api/v1/clusters/:id returns cluster", async () => {
    const createRes = await fetch(`${gatewayUrl}/api/v1/clusters`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gw-cluster-2",
        name: "GW Cluster 2",
        environment: "dev",
        provider: "kind",
      }),
    });
    const created = (await createRes.json()) as { id: string; slug: string };

    const res = await fetch(`${gatewayUrl}/api/v1/clusters/${created.id}`, authed);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; slug: string };
    expect(body.id).toBe(created.id);
    expect(body.slug).toBe("gw-cluster-2");
  });

  it("PATCH /api/v1/clusters/:id updates name", async () => {
    const createRes = await fetch(`${gatewayUrl}/api/v1/clusters`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gw-cluster-patch",
        name: "Original Cluster",
        environment: "stage",
        provider: "gke",
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const patchRes = await fetch(`${gatewayUrl}/api/v1/clusters/${created.id}`, {
      method: "PATCH",
      headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
      body: JSON.stringify({ name: "Updated Cluster" }),
    });
    expect(patchRes.status).toBe(200);
    const updated = (await patchRes.json()) as { name: string };
    expect(updated.name).toBe("Updated Cluster");
  });

  it("DELETE /api/v1/clusters/:id returns 204, GET returns 404", async () => {
    const createRes = await fetch(`${gatewayUrl}/api/v1/clusters`, {
      method: "POST",
      headers: { cookie: "lw-sid=sess_cluster_test", "content-type": "application/json" },
      body: JSON.stringify({
        slug: "gw-cluster-del",
        name: "To Delete",
        environment: "dev",
        provider: "docker-desktop",
      }),
    });
    const created = (await createRes.json()) as { id: string };

    const delRes = await fetch(`${gatewayUrl}/api/v1/clusters/${created.id}`, {
      method: "DELETE",
      headers: { cookie: "lw-sid=sess_cluster_test" },
    });
    expect(delRes.status).toBe(204);

    const getRes = await fetch(`${gatewayUrl}/api/v1/clusters/${created.id}`, authed);
    expect(getRes.status).toBe(404);
  });

  it("GET /api/v1/clusters/:id for unknown id returns 404", async () => {
    const res = await fetch(
      `${gatewayUrl}/api/v1/clusters/00000000-0000-0000-0000-000000000000`,
      authed,
    );
    expect(res.status).toBe(404);
  });
});
