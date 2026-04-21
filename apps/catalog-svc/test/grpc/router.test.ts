import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import {
  CatalogService,
  DependencyKind,
  Lifecycle,
  ServiceType,
} from "@lw-idp/contracts/catalog/v1";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";

describe("catalog-svc ConnectRPC", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let server: LwIdpServer;
  let baseUrl: string;

  beforeAll(async () => {
    pg = await startPostgres({ database: "catalog_grpc_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    server = await buildServer({
      name: "catalog-svc",
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
    return createClient(CatalogService, transport);
  }

  it("CreateService + ListServices round-trips", async () => {
    const c = client();
    const created = await c.createService({
      slug: "rpc-svc-1",
      name: "RPC 1",
      description: "rpc test",
      type: ServiceType.SERVICE,
      lifecycle: Lifecycle.PRODUCTION,
      tags: ["rpc", "test"],
    });
    expect(created.service?.slug).toBe("rpc-svc-1");
    expect(created.service?.lifecycle).toBe(Lifecycle.PRODUCTION);

    const list = await c.listServices({ limit: 10 });
    expect(list.services.some((s) => s.slug === "rpc-svc-1")).toBe(true);
  });

  it("CreateService duplicate slug returns AlreadyExists", async () => {
    const c = client();
    await c.createService({ slug: "rpc-dup", name: "Dup", type: ServiceType.SERVICE });
    await expect(c.createService({ slug: "rpc-dup", name: "Dup" })).rejects.toThrow(
      /already.?exists/i,
    );
  });

  it("GetService by id + UpdateService + DeleteService", async () => {
    const c = client();
    const created = await c.createService({
      slug: "rpc-crud",
      name: "CRUD",
      type: ServiceType.SERVICE,
    });
    const id = created.service?.id ?? "";

    const got = await c.getService({ id });
    expect(got.service?.slug).toBe("rpc-crud");

    const upd = await c.updateService({ id, name: "CRUD v2", lifecycle: Lifecycle.DEPRECATED });
    expect(upd.service?.name).toBe("CRUD v2");
    expect(upd.service?.lifecycle).toBe(Lifecycle.DEPRECATED);

    await c.deleteService({ id });
    await expect(c.getService({ id })).rejects.toThrow(/not.?found/i);
  });

  it("UpdateService with partial fields does not clobber unsent fields", async () => {
    // Regression test for review C1: proto3 scalar defaults ("" for string,
    // 0 for enum) were being forwarded unconditionally into updateService and
    // silently clearing description / lifecycle / repoUrl / tags.
    const c = client();
    const created = await c.createService({
      slug: "partial-update",
      name: "Partial",
      description: "original description",
      type: ServiceType.SERVICE,
      lifecycle: Lifecycle.PRODUCTION,
      repoUrl: "https://example.com/repo",
      tags: ["keep-me"],
    });
    const id = created.service?.id ?? "";

    // Send ONLY the name. Every other field should stay unchanged.
    const upd = await c.updateService({ id, name: "Partial (renamed)" });
    expect(upd.service?.name).toBe("Partial (renamed)");
    expect(upd.service?.description).toBe("original description");
    expect(upd.service?.lifecycle).toBe(Lifecycle.PRODUCTION);
    expect(upd.service?.repoUrl).toBe("https://example.com/repo");
    expect(upd.service?.tags).toEqual(["keep-me"]);
  });

  it("SearchServices finds by name/description", async () => {
    const c = client();
    await c.createService({
      slug: "fts-payments",
      name: "Payments Search",
      description: "search me",
    });
    const res = await c.searchServices({ query: "search" });
    expect(res.services.some((s) => s.slug === "fts-payments")).toBe(true);
  });

  it("AddDependency + RemoveDependency", async () => {
    const c = client();
    const a = await c.createService({ slug: "dep-a", name: "A" });
    const b = await c.createService({ slug: "dep-b", name: "B" });
    await c.addDependency({
      serviceId: a.service?.id ?? "",
      dependsOnServiceId: b.service?.id ?? "",
      kind: DependencyKind.USES,
    });
    await c.removeDependency({
      serviceId: a.service?.id ?? "",
      dependsOnServiceId: b.service?.id ?? "",
    });
  });
});
