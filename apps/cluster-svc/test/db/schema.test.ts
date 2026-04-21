import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("cluster-svc db migrations", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres({ database: "cluster_test" });
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("applies migrations cleanly + is idempotent", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  });

  it("has clusters, cluster_tags, outbox tables", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(expect.arrayContaining(["clusters", "cluster_tags", "outbox"]));
  });

  it("environment and provider enums exist", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const enums = await db.execute<{ typname: string }>(sql`
      SELECT typname FROM pg_type WHERE typtype = 'e' ORDER BY typname
    `);
    const names = enums.map((r) => r.typname);
    expect(names).toEqual(expect.arrayContaining(["environment", "provider"]));
  });

  it("clusters.slug uniqueness is enforced", async () => {
    const { clusters } = await import("../../src/db/schema/index.js");
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    await db.insert(clusters).values({ slug: "kind-dev", name: "Kind Dev" });
    await expect(
      db.insert(clusters).values({ slug: "kind-dev", name: "Kind Dev 2" }),
    ).rejects.toThrow();
  });
});
