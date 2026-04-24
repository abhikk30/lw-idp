import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../../catalog-svc/src/grpc/plugin.js";
import { createUpstreamClients } from "../../src/clients/index.js";

describe("upstream clients — catalog smoke", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let server: LwIdpServer;
  let baseUrl: string;

  beforeAll(async () => {
    pg = await startPostgres({ database: "gateway_clients_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../catalog-svc/src/db/migrations" });

    server = await buildServer({
      name: "catalog-svc-test",
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

  it("gateway-svc catalog client round-trips ListServices", async () => {
    const clients = createUpstreamClients({
      identityUrl: "http://unused",
      catalogUrl: baseUrl,
      clusterUrl: "http://unused",
    });
    const res = await clients.catalog.listServices({ limit: 5 });
    expect(Array.isArray(res.services)).toBe(true);
  });
});
