import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("catalog-svc db migrations", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres({ database: "catalog_test" });
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("applies migrations cleanly + is idempotent", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  });

  it("has services, service_tags, service_dependencies, service_metadata, outbox tables", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = rows.map((r) => r.table_name);
    expect(names).toEqual(
      expect.arrayContaining([
        "services",
        "service_tags",
        "service_dependencies",
        "service_metadata",
        "outbox",
      ]),
    );
  });

  it("services has search_vector (tsvector) + GIN index", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const cols = await db.execute<{ column_name: string; data_type: string }>(sql`
      SELECT column_name, data_type FROM information_schema.columns
      WHERE table_name = 'services' AND column_name = 'search_vector'
    `);
    expect(cols).toHaveLength(1);
    expect(cols[0]?.data_type).toBe("tsvector");

    const idx = await db.execute<{ indexname: string }>(sql`
      SELECT indexname FROM pg_indexes WHERE tablename = 'services' AND indexname = 'services_search_vector_idx'
    `);
    expect(idx).toHaveLength(1);
  });

  it("services.slug uniqueness is enforced", async () => {
    const { services } = await import("../../src/db/schema/index.js");
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    await db.insert(services).values({ slug: "payments-api", name: "Payments API" });
    await expect(
      db.insert(services).values({ slug: "payments-api", name: "Payments API 2" }),
    ).rejects.toThrow();
  });
});
