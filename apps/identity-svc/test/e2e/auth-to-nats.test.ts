import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createOidcVerifier } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { type OutboxPublisherHandle, publishOutbox } from "@lw-idp/events";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type NatsHandle, type PgHandle, startNats, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type JWK, type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { outbox } from "../../src/db/schema/index.js";
import { registerConnectRpc } from "../../src/grpc/plugin.js";
import { registerAuthRoutes } from "../../src/http/auth.js";
import { createStateStore } from "../../src/services/oidc.js";

describe("identity-svc end-to-end: /auth/callback → user row + NATS event", () => {
  let pg: PgHandle;
  let natsH: NatsHandle;
  let db: PostgresJsDatabase;
  let nc: NatsConnection;
  let dexServer: Server;
  let dexPort: number;
  let server: LwIdpServer;
  let baseUrl: string;
  let publisher: OutboxPublisherHandle | undefined;
  const state = "e2e-state";

  beforeAll(async () => {
    // 1. Infra
    pg = await startPostgres({ database: "identity_e2e_test" });
    natsH = await startNats();

    // 2. DB
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    // 3. NATS stream + consumer
    nc = await natsConnect({ servers: natsH.url });
    const jsm = await nc.jetstreamManager();
    await jsm.streams.add({ name: "E2E_STREAM", subjects: ["idp.>"] });
    await jsm.consumers.add("E2E_STREAM", {
      name: "e2e-user-created",
      filter_subject: "idp.identity.user.created",
      ack_policy: AckPolicy.Explicit,
      deliver_policy: DeliverPolicy.All,
    });

    // 4. Fake Dex server (JWKS + token endpoint)
    const kp = await generateKeyPair("RS256");
    const privateKey: KeyLike = kp.privateKey;
    const publicJwk: JWK = {
      ...(await exportJWK(kp.publicKey)),
      alg: "RS256",
      kid: "e2e-kid",
      use: "sig",
    };

    dexServer = createServer(async (req, res) => {
      if (req.url === "/keys") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (req.method === "POST" && req.url === "/token") {
        const issuer = `http://127.0.0.1:${dexPort}`;
        const token = await new SignJWT({
          email: "bob@example.com",
          name: "Bob",
          picture: "https://x/b.png",
        })
          .setProtectedHeader({ alg: "RS256", kid: "e2e-kid" })
          .setIssuer(issuer)
          .setAudience("lw-idp-gateway")
          .setSubject("gh|e2e-user")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            access_token: "a",
            id_token: token,
            token_type: "Bearer",
            expires_in: 300,
          }),
        );
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => dexServer.listen(0, "127.0.0.1", () => r()));
    const addr = dexServer.address() as AddressInfo;
    dexPort = addr.port;

    // 5. Verifier (pointed at fake Dex)
    const verifier = createOidcVerifier({
      issuer: `http://127.0.0.1:${dexPort}`,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });

    // 6. State store with pre-seeded state
    const stateStore = createStateStore({ ttlMs: 60_000 });
    stateStore.put(state, { codeVerifier: "e2e-verifier" });

    // 7. Start publisher against the same DB + real NATS
    const js = nc.jetstream();
    publisher = publishOutbox({
      db,
      js,
      table: outbox,
      pollIntervalMs: 100,
    });

    // 8. Spin up identity-svc
    server = await buildServer({
      name: "identity-svc",
      port: 0,
      register: async (fastify) => {
        await registerConnectRpc(fastify, { db, verifier });
        await registerAuthRoutes(fastify, {
          db,
          verifier,
          stateStore,
          oidc: {
            issuer: `http://127.0.0.1:${dexPort}`,
            clientId: "lw-idp-gateway",
            clientSecret: "shh",
            redirectUri: "http://127.0.0.1/auth/callback",
            scopes: ["openid", "email", "profile"],
          },
          cookie: { secure: false, maxAgeSeconds: 3600 },
        });
      },
    });
    const addr2 = await server.listen();
    // fastify returns "http://0.0.0.0:PORT" when binding to 0.0.0.0 — replace for fetch
    baseUrl = addr2.replace("0.0.0.0", "127.0.0.1");
  }, 120_000);

  afterAll(async () => {
    await server?.close();
    await publisher?.stop();
    await new Promise<void>((r) => dexServer?.close(() => r()));
    await nc?.drain();
    await pg?.stop();
    await natsH?.stop();
  });

  it("completes the full flow: callback → user row → NATS event", async () => {
    // Hit /auth/callback
    const res = await fetch(`${baseUrl}/auth/callback?code=e2ecode&state=${state}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie") ?? "").toMatch(/^lw-sid=sess_/);

    // User row present
    const userRows = await db.execute<{ subject: string; email: string }>(
      sql`SELECT subject, email FROM users WHERE subject = 'gh|e2e-user'`,
    );
    expect(userRows.length).toBe(1);
    expect(userRows[0]?.email).toBe("bob@example.com");

    // NATS event delivered
    const js = nc.jetstream();
    const consumer = await js.consumers.get("E2E_STREAM", "e2e-user-created");
    const iter = await consumer.consume({ max_messages: 1 });
    const timer = setTimeout(() => iter.stop(), 10_000);
    let event: { type?: string; data?: { subject?: string; email?: string } } | undefined;
    for await (const m of iter) {
      const codec = JSONCodec();
      event = codec.decode(m.data) as typeof event;
      m.ack();
      break;
    }
    clearTimeout(timer);

    expect(event?.type).toBe("idp.identity.user.created");
    expect(event?.data?.subject).toBe("gh|e2e-user");
    expect(event?.data?.email).toBe("bob@example.com");
  }, 30_000);
});
