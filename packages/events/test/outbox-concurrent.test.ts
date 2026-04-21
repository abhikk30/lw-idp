import { type NatsHandle, type PgHandle, startNats, startPostgres } from "@lw-idp/testing";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type OutboxPublisherHandle,
  createEnvelope,
  outboxTable,
  publishOutbox,
} from "../src/index.js";

describe("outbox publisher with two concurrent replicas", () => {
  let pg: PgHandle;
  let nats: NatsHandle;
  let nc: NatsConnection;
  let sql: ReturnType<typeof postgres>;
  const outbox = outboxTable("outbox");

  beforeAll(async () => {
    pg = await startPostgres();
    nats = await startNats();
    sql = postgres(pg.connectionString, { max: 8, prepare: false });
    const db = drizzle(sql);

    await sql`CREATE TABLE IF NOT EXISTS outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aggregate TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ
    )`;

    nc = await natsConnect({ servers: nats.url });
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({ name: "CONCURRENT_STREAM", subjects: ["idp.>"] });
    await jsm.consumers.add("CONCURRENT_STREAM", {
      name: "counter",
      filter_subject: "idp.test.concurrent",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });

    // Seed 20 rows
    for (let i = 0; i < 20; i++) {
      const env = createEnvelope({
        type: "idp.test.concurrent",
        source: "test",
        data: { n: i },
      });
      await db.insert(outbox).values({
        aggregate: "t",
        eventType: env.type,
        payload: env,
      });
    }
  }, 120_000);

  afterAll(async () => {
    await nc?.drain();
    await sql?.end();
    await pg?.stop();
    await nats?.stop();
  });

  it("two publishers deliver each row exactly once", async () => {
    // Two separate DB clients (simulates two pods)
    const sql1 = postgres(pg.connectionString, { max: 4, prepare: false });
    const sql2 = postgres(pg.connectionString, { max: 4, prepare: false });
    const db1 = drizzle(sql1);
    const db2 = drizzle(sql2);

    const js = nc.jetstream();
    const p1: OutboxPublisherHandle = publishOutbox({
      db: db1,
      js,
      table: outbox,
      pollIntervalMs: 50,
      batchSize: 5,
    });
    const p2: OutboxPublisherHandle = publishOutbox({
      db: db2,
      js,
      table: outbox,
      pollIntervalMs: 50,
      batchSize: 5,
    });

    try {
      // Count messages delivered to the consumer
      const consumer = await js.consumers.get("CONCURRENT_STREAM", "counter");
      const seen = new Set<number>();
      const iter = await consumer.consume({ max_messages: 50 });
      const codec = JSONCodec();
      const timer = setTimeout(() => iter.stop(), 6000);
      for await (const m of iter) {
        const env = codec.decode(m.data) as { data?: { n?: number } };
        if (typeof env.data?.n === "number") {
          seen.add(env.data.n);
        }
        m.ack();
        if (seen.size === 20) {
          break;
        }
      }
      clearTimeout(timer);

      expect(seen.size).toBe(20); // all 20 unique rows delivered
    } finally {
      await p1.stop();
      await p2.stop();
      await sql1.end();
      await sql2.end();
    }
  }, 30_000);
});
