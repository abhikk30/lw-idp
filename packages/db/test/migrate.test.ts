import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { connect, runMigrations } from "../src/index.js";

describe("runMigrations", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres();
  }, 60_000);
  afterAll(async () => {
    await pg?.stop();
  });

  it("applies an empty migration set idempotently", async () => {
    const db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "test/fixtures/migrations" });
    // second run should be a no-op
    await runMigrations(db, { migrationsFolder: "test/fixtures/migrations" });
    expect(true).toBe(true);
  });
});
