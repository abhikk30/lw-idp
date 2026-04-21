import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { ClusterService, Environment, Provider } from "@lw-idp/contracts/cluster/v1";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";

describe("cluster-svc ConnectRPC", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let server: LwIdpServer;
  let baseUrl: string;

  beforeAll(async () => {
    pg = await startPostgres({ database: "cluster_grpc_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    server = await buildServer({
      name: "cluster-svc",
      port: 0,
      register: async (fastify) => {
        await registerConnectRpc(fastify, { db });
      },
    });
    const addr = await server.listen();
    baseUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    await pg?.stop();
  });

  function client() {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    return createClient(ClusterService, transport);
  }

  it("RegisterCluster + ListClusters round-trips", async () => {
    const c = client();
    const created = await c.registerCluster({
      slug: "rpc-kind-1",
      name: "RPC Kind 1",
      environment: Environment.DEV,
      provider: Provider.KIND,
      region: "local",
      tags: ["rpc", "test"],
    });
    expect(created.cluster?.slug).toBe("rpc-kind-1");
    expect(created.cluster?.provider).toBe(Provider.KIND);

    const list = await c.listClusters({ limit: 10 });
    expect(list.clusters.some((c) => c.slug === "rpc-kind-1")).toBe(true);
  });

  it("RegisterCluster duplicate slug returns AlreadyExists", async () => {
    const c = client();
    await c.registerCluster({ slug: "rpc-dup-cluster", name: "Dup", provider: Provider.KIND });
    await expect(c.registerCluster({ slug: "rpc-dup-cluster", name: "Dup 2" })).rejects.toThrow(
      /already.?exists/i,
    );
  });

  it("GetCluster by id + UpdateCluster + DeregisterCluster", async () => {
    const c = client();
    const created = await c.registerCluster({
      slug: "rpc-crud-cluster",
      name: "CRUD Cluster",
      provider: Provider.EKS,
    });
    const id = created.cluster?.id ?? "";

    const got = await c.getCluster({ id });
    expect(got.cluster?.slug).toBe("rpc-crud-cluster");

    const upd = await c.updateCluster({ id, name: "CRUD Cluster v2", region: "us-west-2" });
    expect(upd.cluster?.name).toBe("CRUD Cluster v2");
    expect(upd.cluster?.region).toBe("us-west-2");

    await c.deregisterCluster({ id });
    await expect(c.getCluster({ id })).rejects.toThrow(/not.?found/i);
  });

  it("ListClusters with environment filter returns only matching clusters", async () => {
    const c = client();
    await c.registerCluster({
      slug: "prod-eks",
      name: "Prod EKS",
      environment: Environment.PROD,
      provider: Provider.EKS,
    });
    await c.registerCluster({
      slug: "stage-gke",
      name: "Stage GKE",
      environment: Environment.STAGE,
      provider: Provider.GKE,
    });

    const prodList = await c.listClusters({
      limit: 20,
      environmentFilter: Environment.PROD,
    });
    expect(prodList.clusters.some((cl) => cl.slug === "prod-eks")).toBe(true);
    for (const cl of prodList.clusters) {
      expect(cl.environment).toBe(Environment.PROD);
    }
  });
});
