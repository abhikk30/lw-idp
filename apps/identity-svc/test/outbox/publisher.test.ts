import { connect, runMigrations } from "@lw-idp/db";
import { publishOutbox } from "@lw-idp/events";
import { type NatsHandle, type PgHandle, startNats, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox } from "../../src/db/schema/index.js";
import { upsertUserBySubject } from "../../src/services/users.js";

describe("identity-svc outbox → NATS", () => {
  let pg: PgHandle;
  let nats: NatsHandle;
  let nc: NatsConnection;
  let db: PostgresJsDatabase;
  let publisherHandle: { stop: () => Promise<void> } | undefined;

  beforeAll(async () => {
    pg = await startPostgres({ database: "identity_outbox_test" });
    nats = await startNats();
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    nc = await natsConnect({ servers: nats.url });
    const jsm = await nc.jetstreamManager();
    try {
      await jsm.streams.add({ name: "TEST_STREAM", subjects: ["idp.>"] });
    } catch {
      // stream likely already exists (reuse container); update subjects to ensure match
      await jsm.streams.update("TEST_STREAM", { subjects: ["idp.>"] });
    }
    try {
      await jsm.consumers.add("TEST_STREAM", {
        name: "test-user-created",
        durable_name: "test-user-created",
        filter_subject: "idp.identity.user.created",
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.All,
      });
    } catch {
      // consumer may already exist from a previous run; ignore
    }
  }, 120_000);

  afterAll(async () => {
    await publisherHandle?.stop();
    await nc?.drain();
    await pg?.stop();
    await nats?.stop();
  });

  it("publishes idp.identity.user.created after upsertUserBySubject", async () => {
    const js = nc.jetstream();

    publisherHandle = publishOutbox({
      db,
      js,
      table: outbox,
      pollIntervalMs: 100,
    });

    await upsertUserBySubject(db, {
      subject: "gh|outbox-test-1",
      email: "ot@example.com",
      displayName: "Outbox Tester",
    });

    // Pull the message from the consumer
    const consumer = await js.consumers.get("TEST_STREAM", "test-user-created");
    const iter = await consumer.consume({ max_messages: 1, expires: 5000 });
    const timer = setTimeout(() => iter.stop(), 5_000);

    let gotEvent: { type?: string; data?: { subject?: string } } | undefined;
    for await (const m of iter) {
      const codec = JSONCodec();
      gotEvent = codec.decode(m.data) as typeof gotEvent;
      m.ack();
      break;
    }
    clearTimeout(timer);

    expect(gotEvent?.type).toBe("idp.identity.user.created");
    expect(gotEvent?.data?.subject).toBe("gh|outbox-test-1");
  }, 30_000);
});
