import { type NatsHandle, type PgHandle, startNats, startPostgres } from "@lw-idp/testing";
import { drizzle } from "drizzle-orm/postgres-js";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type JetStreamManager,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import postgres from "postgres";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type OutboxPublisherHandle,
  createEnvelope,
  outboxTable,
  publishOutbox,
} from "../src/index.js";

describe("outbox publisher", () => {
  let pg: PgHandle;
  let nats: NatsHandle;
  let nc: NatsConnection;
  let jsm: JetStreamManager;
  let sql: ReturnType<typeof postgres>;
  let db: ReturnType<typeof drizzle>;
  let handle: OutboxPublisherHandle | undefined;

  const outbox = outboxTable("outbox");

  beforeAll(async () => {
    pg = await startPostgres();
    nats = await startNats();

    sql = postgres(pg.connectionString, { max: 4, prepare: false });
    db = drizzle(sql);

    await sql`CREATE TABLE IF NOT EXISTS outbox (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      aggregate TEXT NOT NULL,
      event_type TEXT NOT NULL,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      published_at TIMESTAMPTZ
    )`;
    await sql`CREATE INDEX IF NOT EXISTS outbox_unpublished_idx ON outbox (created_at) WHERE published_at IS NULL`;

    nc = await natsConnect({ servers: nats.url });
    jsm = await nc.jetstreamManager();
    // Ensure a stream exists that captures the subject our test uses.
    // If it already exists (reuse container), ignore the error.
    try {
      await jsm.streams.add({ name: "TEST_STREAM", subjects: ["idp.>"] });
    } catch {
      // stream likely already exists; update it to ensure subjects match
      await jsm.streams.update("TEST_STREAM", { subjects: ["idp.>"] });
    }
  }, 90_000);

  afterAll(async () => {
    await nc?.drain();
    await sql?.end();
    await pg?.stop();
    await nats?.stop();
  });

  afterEach(async () => {
    await handle?.stop();
    handle = undefined;
    await sql`TRUNCATE outbox`;
    // Clean up the named consumer between test runs
    try {
      await jsm.consumers.delete("TEST_STREAM", "test-outbox-consumer");
    } catch {
      // may not exist; ignore
    }
  });

  it("publishes an unpublished outbox row to NATS and marks it published", async () => {
    const envelope = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: { id: "u_1", email: "a@b.com" },
    });
    await db.insert(outbox).values({
      aggregate: "user",
      eventType: envelope.type,
      payload: envelope,
    });

    // Create a durable pull consumer so we can fetch the message
    await jsm.consumers.add("TEST_STREAM", {
      name: "test-outbox-consumer",
      durable_name: "test-outbox-consumer",
      filter_subject: "idp.identity.user.created",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });

    const js = nc.jetstream();
    const consumer = await js.consumers.get("TEST_STREAM", "test-outbox-consumer");

    handle = publishOutbox({
      db,
      js,
      table: outbox,
      pollIntervalMs: 100,
    });

    // Pull the message within 5s
    const iter = await consumer.consume({ max_messages: 1, expires: 5000 });
    let gotType: string | undefined;
    const timer = setTimeout(() => iter.stop(), 5000);
    for await (const m of iter) {
      const codec = JSONCodec();
      const decoded = codec.decode(m.data) as { type?: string };
      gotType = decoded.type;
      m.ack();
      break;
    }
    clearTimeout(timer);

    expect(gotType).toBe("idp.identity.user.created");

    // Row should now be marked published — give a short grace period for the DB update
    await new Promise((r) => setTimeout(r, 200));
    const rows = await db.select().from(outbox);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.publishedAt).not.toBeNull();
  }, 30_000);
});
