import { type SessionRecord, createRedisSessionStore } from "@lw-idp/auth";
import { createEnvelope, subjects } from "@lw-idp/events";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
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
import {
  type NotificationConsumerHandle,
  startNotificationConsumer,
} from "../../src/nats/consumer.js";
import { ConnectionRegistry } from "../../src/registry.js";
import { wsPlugin } from "../../src/ws/plugin.js";

interface Pod {
  server: LwIdpServer;
  consumer: NotificationConsumerHandle;
  registry: ConnectionRegistry;
  wsUrl: string;
  consumerName: string;
}

async function startPod(opts: {
  podName: string;
  redisUrl: string;
  nc: NatsConnection;
}): Promise<Pod> {
  const sessionStore = createRedisSessionStore({ url: opts.redisUrl });
  const registry = new ConnectionRegistry();
  const server = await buildServer({
    name: `notification-svc-${opts.podName}`,
    port: 0,
    register: async (fastify) => {
      await fastify.register(wsPlugin, {
        sessionStore,
        registry,
        rateLimitPerSec: 1000,
        rateLimitBurst: 100,
      });
    },
    onShutdown: async () => {
      await sessionStore.close();
    },
  });
  const addr = await server.listen();
  const httpUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
    "0.0.0.0",
    "127.0.0.1",
  );
  const wsUrl = httpUrl.replace("http://", "ws://");

  const consumer = await startNotificationConsumer({
    nc: opts.nc,
    consumerNamePrefix: `notification-svc-${opts.podName}`,
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

  return { server, consumer, registry, wsUrl, consumerName: consumer.consumerName };
}

describe("notification-svc two-pod fan-out isolation", () => {
  let natsH: NatsHandle;
  let redisH: RedisHandle;
  let nc: NatsConnection;
  let podA: Pod;
  let podB: Pod;

  // Two distinct sessions: S1 in team-a, S2 in team-b. Different SIDs in
  // Dragonfly. Both pods share the SessionStore (Dragonfly), so either pod
  // can authenticate either client.
  const SID_1 = "sess_b5_one";
  const SID_2 = "sess_b5_two";
  const session1: SessionRecord = {
    userId: "u-b5-1",
    email: "u1@test",
    displayName: "U1",
    teams: [{ id: "team-a", slug: "team-a", name: "team-a" }],
    createdAt: new Date().toISOString(),
  };
  const session2: SessionRecord = {
    userId: "u-b5-2",
    email: "u2@test",
    displayName: "U2",
    teams: [{ id: "team-b", slug: "team-b", name: "team-b" }],
    createdAt: new Date().toISOString(),
  };

  beforeAll(async () => {
    natsH = await startNats();
    redisH = await startRedis();
    nc = await natsConnect({ servers: natsH.url });

    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({
      name: "IDP_DOMAIN",
      subjects: ["idp.>"],
      retention: RetentionPolicy.Limits,
      storage: StorageType.Memory,
      num_replicas: 1,
    });

    const sessionStore = createRedisSessionStore({ url: redisH.url });
    await sessionStore.set(SID_1, session1, { ttlSeconds: 600 });
    await sessionStore.set(SID_2, session2, { ttlSeconds: 600 });
    await sessionStore.close();

    podA = await startPod({ podName: "podA", redisUrl: redisH.url, nc });
    podB = await startPod({ podName: "podB", redisUrl: redisH.url, nc });
  }, 120_000);

  afterAll(async () => {
    await podA?.consumer.stop();
    await podB?.consumer.stop();
    await podA?.server.close();
    await podB?.server.close();
    await nc?.drain();
    await redisH?.stop();
    await natsH?.stop();
  });

  it("each pod has a distinct ephemeral consumer name (no queue-group sharing)", () => {
    expect(podA.consumerName).not.toBe(podB.consumerName);
    expect(podA.consumerName).toMatch(/^notification-svc-podA-/);
    expect(podB.consumerName).toMatch(/^notification-svc-podB-/);
  });

  it("client connected to pod A receives team-a events; client on pod B does NOT", async () => {
    const c1 = openWsClient({ url: `${podA.wsUrl}/ws/stream`, cookie: `lw-sid=${SID_1}` });
    const c2 = openWsClient({ url: `${podB.wsUrl}/ws/stream`, cookie: `lw-sid=${SID_2}` });
    await c1.opened;
    await c2.opened;

    // Drain welcomes on both
    await c1.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );
    await c2.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );

    // Publish event ONLY matching team-a (session1).
    const js = nc.jetstream();
    const codec = JSONCodec();
    const env = createEnvelope({
      type: subjects.catalogServiceCreated,
      source: "catalog-svc",
      data: { id: "svc-team-a", owner_team_id: "team-a" },
    });
    await js.publish(subjects.catalogServiceCreated, codec.encode(env));

    // C1 must receive within 2s.
    const f1 = await c1.waitFor<{ type: string; payload: { id: string } }>(
      (m): m is { type: string; payload: { id: string } } =>
        typeof m === "object" && (m as { type?: string }).type === subjects.catalogServiceCreated,
      2_000,
    );
    expect(f1.payload.id).toBe("svc-team-a");

    // C2 must NOT receive within 1.5s.
    let leaked: unknown = undefined;
    try {
      leaked = await c2.waitFor<{ type: string }>(
        (m): m is { type: string } =>
          typeof m === "object" && (m as { type?: string }).type === subjects.catalogServiceCreated,
        1_500,
      );
    } catch {
      // expected timeout
    }
    expect(leaked).toBeUndefined();

    await c1.close();
    await c2.close();
  }, 120_000);

  it("publishing a team.created (everyone-allowed) reaches both pods' clients", async () => {
    const c1 = openWsClient({ url: `${podA.wsUrl}/ws/stream`, cookie: `lw-sid=${SID_1}` });
    const c2 = openWsClient({ url: `${podB.wsUrl}/ws/stream`, cookie: `lw-sid=${SID_2}` });
    await c1.opened;
    await c2.opened;
    await c1.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );
    await c2.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === "welcome",
      2_000,
    );

    const js = nc.jetstream();
    const codec = JSONCodec();
    const env = createEnvelope({
      type: subjects.identityTeamCreated,
      source: "identity-svc",
      data: { team_id: "team-new", id: "team-new" },
    });
    await js.publish(subjects.identityTeamCreated, codec.encode(env));

    const f1 = await c1.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === subjects.identityTeamCreated,
      2_000,
    );
    const f2 = await c2.waitFor<{ type: string }>(
      (m): m is { type: string } =>
        typeof m === "object" && (m as { type?: string }).type === subjects.identityTeamCreated,
      2_000,
    );
    expect(f1.type).toBe(subjects.identityTeamCreated);
    expect(f2.type).toBe(subjects.identityTeamCreated);

    await c1.close();
    await c2.close();
  }, 120_000);
});
