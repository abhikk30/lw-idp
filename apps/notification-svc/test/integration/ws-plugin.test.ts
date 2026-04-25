import { type SessionRecord, createRedisSessionStore } from "@lw-idp/auth";
import { createEnvelope, subjects } from "@lw-idp/events";
import { buildServer } from "@lw-idp/service-kit";
import {
  type NatsHandle,
  type RedisHandle,
  openWsClient,
  startNats,
  startRedis,
} from "@lw-idp/testing";
import {
  JSONCodec,
  type NatsConnection,
  RetentionPolicy,
  StorageType,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { canUserSeeEvent } from "../../src/authz.js";
import { envelopeToFrame } from "../../src/frame.js";
import { startNotificationConsumer } from "../../src/nats/consumer.js";
import { ConnectionRegistry } from "../../src/registry.js";
import { wsPlugin } from "../../src/ws/plugin.js";

describe("notification-svc single-pod fan-out", () => {
  let natsH: NatsHandle;
  let redisH: RedisHandle;
  let nc: NatsConnection;
  let session: SessionRecord;
  let serverUrl: string;
  let close: () => Promise<void> = async () => {};

  const SID = "sess_int_b4";
  const SESSION_KEY = SID;

  beforeAll(async () => {
    natsH = await startNats();
    redisH = await startRedis();
    nc = await natsConnect({ servers: natsH.url });

    // Create the IDP_DOMAIN stream (in cluster, NACK creates it; tests do it explicitly).
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({
      name: "IDP_DOMAIN",
      subjects: ["idp.>"],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
      num_replicas: 1,
    });

    // Seed a session in Dragonfly.
    const sessionStore = createRedisSessionStore({ url: redisH.url });
    session = {
      userId: "u-int-1",
      subject: "gh|int-1",
      email: "int@test",
      displayName: "Int",
      teams: [{ id: "team-a", slug: "team-a", name: "team-a" }],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set(SESSION_KEY, session, { ttlSeconds: 600 });

    // Start the notification-svc Fastify with WS plugin.
    const registry = new ConnectionRegistry();
    const server = await buildServer({
      name: "notification-svc-int",
      port: 0,
      register: async (fastify) => {
        await fastify.register(wsPlugin, {
          sessionStore,
          registry,
          rateLimitPerSec: 1000,
          rateLimitBurst: 100,
        });
      },
    });
    const addr = await server.listen();
    const httpUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
    serverUrl = httpUrl.replace("http://", "ws://");

    // Start NATS consumer wired to registry.all() and authz filter.
    const consumerHandle = await startNotificationConsumer({
      nc,
      consumerNamePrefix: "test-b4",
      onEnvelope: (env) => {
        for (const conn of registry.all()) {
          if (!canUserSeeEvent(conn.session, env)) {
            continue;
          }
          if (!conn.bucket.take()) {
            registry.recordShed();
            continue;
          }
          const frame = envelopeToFrame(env);
          conn.send(JSON.stringify(frame));
        }
      },
    });

    close = async () => {
      await consumerHandle.stop();
      await server.close();
      await sessionStore.close();
    };
  }, 120_000);

  afterAll(async () => {
    await close();
    await nc?.drain();
    await redisH?.stop();
    await natsH?.stop();
  });

  it("delivers a matching catalog.service.created envelope to the WS client within 2s", async () => {
    const ws = openWsClient({
      url: `${serverUrl}/ws/stream`,
      cookie: `lw-sid=${SID}`,
    });
    await ws.opened;
    // Wait for welcome frame so we know the connection is registered.
    const welcome = await ws.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );
    expect(welcome.type).toBe("welcome");

    // Publish a matching event (owner_team_id = team-a; session has team-a).
    const js = nc.jetstream();
    const codec = JSONCodec();
    const env = createEnvelope({
      type: subjects.catalogServiceCreated,
      source: "catalog-svc",
      data: { id: "svc-1", owner_team_id: "team-a" },
    });
    await js.publish(subjects.catalogServiceCreated, codec.encode(env));

    const frame = await ws.waitFor<{
      type: string;
      entity: string;
      action: string;
      payload: { owner_team_id: string };
    }>(
      (
        m,
      ): m is {
        type: string;
        entity: string;
        action: string;
        payload: { owner_team_id: string };
      } =>
        typeof m === "object" && (m as { type?: string }).type === subjects.catalogServiceCreated,
      2_000,
    );
    expect(frame.type).toBe(subjects.catalogServiceCreated);
    expect(frame.entity).toBe("service");
    expect(frame.action).toBe("created");
    expect(frame.payload.owner_team_id).toBe("team-a");

    await ws.close();
  }, 120_000);

  it("does NOT deliver a non-matching envelope (owner team mismatch)", async () => {
    const ws = openWsClient({
      url: `${serverUrl}/ws/stream`,
      cookie: `lw-sid=${SID}`,
    });
    await ws.opened;
    await ws.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );

    const js = nc.jetstream();
    const codec = JSONCodec();
    const env = createEnvelope({
      type: subjects.catalogServiceCreated,
      source: "catalog-svc",
      data: { id: "svc-other", owner_team_id: "team-z" }, // not in session.teams
    });
    await js.publish(subjects.catalogServiceCreated, codec.encode(env));

    // Assert no service-created frame arrives within 1.5s. Use a race against a
    // timeout that resolves to "no frame" — i.e. waitFor MUST throw.
    let received: unknown = undefined;
    try {
      received = await ws.waitFor<{ type: string }>(
        (m): m is { type: string } =>
          typeof m === "object" && (m as { type?: string }).type === subjects.catalogServiceCreated,
        1_500,
      );
    } catch {
      // expected: timeout
    }
    expect(received).toBeUndefined();

    await ws.close();
  }, 120_000);
});
