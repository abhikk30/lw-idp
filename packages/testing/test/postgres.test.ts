import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type PgHandle, startPostgres } from "../src/postgres.js";

describe("startPostgres", () => {
  let pg: PgHandle;

  beforeAll(async () => {
    pg = await startPostgres();
  }, 60_000);
  afterAll(async () => {
    await pg?.stop();
  });

  it("returns a live connection URL", async () => {
    expect(pg.connectionString).toMatch(/^postgres:\/\//);
    const { Client } = await import("pg");
    const client = new Client({ connectionString: pg.connectionString });
    await client.connect();
    const { rows } = await client.query<{ one: number }>("select 1::int as one");
    expect(rows[0].one).toBe(1);
    await client.end();
  });
});
