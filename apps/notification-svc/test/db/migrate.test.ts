import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("notification-svc migrations", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres({ database: "notification_migrate_test" });
  }, 120_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("creates notifications + outbox tables", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const tables = await db.execute<{ table_name: string }>(
      sql`SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1`,
    );
    const names = tables.map((r) => r.table_name);
    expect(names).toContain("notifications");
    expect(names).toContain("outbox");
  });
});
