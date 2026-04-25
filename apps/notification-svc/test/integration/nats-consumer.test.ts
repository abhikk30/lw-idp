import { createEnvelope, subjects } from "@lw-idp/events";
import { type NatsHandle, startNats } from "@lw-idp/testing";
import {
  JSONCodec,
  type NatsConnection,
  RetentionPolicy,
  StorageType,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type NotificationConsumerHandle,
  startNotificationConsumer,
} from "../../src/nats/consumer.js";

describe("startNotificationConsumer (integration)", () => {
  let natsHandle: NatsHandle;
  let nc: NatsConnection;

  beforeAll(async () => {
    natsHandle = await startNats();
    nc = await natsConnect({ servers: natsHandle.url });
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({
      name: "IDP_DOMAIN",
      subjects: ["idp.>"],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
      num_replicas: 1,
    });
  }, 120_000);

  afterAll(async () => {
    await nc?.drain();
    await natsHandle?.stop();
  });

  it("delivers a published envelope to the onEnvelope callback within 2s", async () => {
    const received: string[] = [];
    let handle: NotificationConsumerHandle | undefined;
    try {
      handle = await startNotificationConsumer({
        nc,
        consumerNamePrefix: "test-notif",
        onEnvelope: (env) => {
          received.push(env.type);
        },
      });

      // Give the consumer a moment to register before publishing.
      await new Promise((r) => setTimeout(r, 100));

      const js = nc.jetstream();
      const codec = JSONCodec();
      const env = createEnvelope({
        type: subjects.catalogServiceCreated,
        source: "catalog-svc",
        data: { id: "svc-1", owner_team_id: "team-a" },
      });
      await js.publish(subjects.catalogServiceCreated, codec.encode(env));

      // Wait up to 2s for delivery.
      const deadline = Date.now() + 2_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }

      expect(received).toContain(subjects.catalogServiceCreated);
    } finally {
      await handle?.stop();
    }
  }, 120_000);

  it("invokes onError for a malformed envelope but keeps consuming", async () => {
    const errs: unknown[] = [];
    const received: string[] = [];
    let handle: NotificationConsumerHandle | undefined;
    try {
      handle = await startNotificationConsumer({
        nc,
        consumerNamePrefix: "test-notif-err",
        onEnvelope: (env) => {
          received.push(env.type);
        },
        onError: (err) => {
          errs.push(err);
        },
      });
      await new Promise((r) => setTimeout(r, 100));

      const js = nc.jetstream();
      const codec = JSONCodec<unknown>();
      // Malformed: missing required envelope fields
      await js.publish("idp.broken.thing", codec.encode({ not: "an envelope" }));
      // Then a good one
      const good = createEnvelope({
        type: subjects.identityTeamCreated,
        source: "identity-svc",
        data: { team_id: "t-1", id: "t-1" },
      });
      await js.publish(subjects.identityTeamCreated, codec.encode(good));

      const deadline = Date.now() + 3_000;
      while (received.length === 0 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 50));
      }
      expect(errs.length).toBeGreaterThanOrEqual(1);
      expect(received).toContain(subjects.identityTeamCreated);
    } finally {
      await handle?.stop();
    }
  }, 120_000);
});
