import { connect, runMigrations } from "@lw-idp/db";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("identity-svc db migrations", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres({ database: "identity_test" });
  }, 60_000);

  afterAll(async () => {
    await pg?.stop();
  });

  it("applies the init migration cleanly", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    // second run is a no-op
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
  });

  it("has users, teams, team_memberships, user_sessions, outbox tables", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });
    const rows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' ORDER BY table_name
    `);
    const names = rows.map((r) => r.table_name);
    // drizzle_migrations lives in schema "drizzle", not "public" — checked separately
    expect(names).toEqual(
      expect.arrayContaining(["users", "teams", "team_memberships", "user_sessions", "outbox"]),
    );

    // verify drizzle migrations tracking table exists in its own schema
    const migRows = await db.execute<{ table_name: string }>(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'drizzle' ORDER BY table_name
    `);
    expect(migRows.map((r) => r.table_name)).toContain("drizzle_migrations");
  });

  it("enforces users.subject uniqueness", async () => {
    const { users } = await import("../../src/db/schema/index.js");
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    await db.insert(users).values({ subject: "gh|1", email: "a@b.com" });
    await expect(db.insert(users).values({ subject: "gh|1", email: "c@d.com" })).rejects.toThrow();
  });
});
