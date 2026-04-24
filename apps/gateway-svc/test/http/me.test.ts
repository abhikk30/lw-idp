import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import {
  type SessionRecord,
  type SessionStore,
  type SessionStoreSetOptions,
  createOidcVerifier,
} from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type JWK, type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc as registerIdentityConnectRpc } from "../../../identity-svc/src/grpc/plugin.js";
import { createIdentityClient } from "../../src/clients/identity.js";
import { mePlugin } from "../../src/http/me.js";
import { sessionPlugin } from "../../src/middleware/session.js";

function memorySession(): SessionStore {
  const m = new Map<string, SessionRecord>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v, _o: SessionStoreSetOptions) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async close() {
      m.clear();
    },
  };
}

describe("gateway GET /api/v1/me", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let identityServer: LwIdpServer;
  let identityUrl: string;
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let jwksServer: Server;
  let jwksPort: number;
  let privateKey: KeyLike;
  let publicJwk: JWK;
  let userId: string;

  beforeAll(async () => {
    // 1. Postgres + identity-svc migrations
    pg = await startPostgres({ database: "gateway_me_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../identity-svc/src/db/migrations" });

    // 2. Fake JWKS server
    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    publicJwk = { ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "me-kid", use: "sig" };

    jwksServer = createServer((req, res) => {
      if (req.url === "/keys") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", () => r()));
    jwksPort = (jwksServer.address() as AddressInfo).port;

    // 3. Identity-svc in-process
    const verifier = createOidcVerifier({
      issuer: `http://127.0.0.1:${jwksPort}`,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });

    identityServer = await buildServer({
      name: "identity-svc",
      port: 0,
      register: async (fastify) => {
        await registerIdentityConnectRpc(fastify, { db, verifier });
      },
    });
    const iAddr = await identityServer.listen();
    identityUrl = (typeof iAddr === "string" ? iAddr : `http://127.0.0.1:${iAddr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );

    // 4. Pre-create a user by calling VerifyToken (upserts user in DB)
    const identityClient = createIdentityClient(identityUrl);
    const idToken = await new SignJWT({ email: "me-alice@example.com", name: "Me Alice" })
      .setProtectedHeader({ alg: "RS256", kid: "me-kid" })
      .setIssuer(`http://127.0.0.1:${jwksPort}`)
      .setAudience("lw-idp-gateway")
      .setSubject("gh|me-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verifyResult = await identityClient.verifyToken({ idToken });
    if (!verifyResult.user) {
      throw new Error("identity.VerifyToken returned no user");
    }
    userId = verifyResult.user.id;

    // 5. Pre-seed a session so we can skip the full auth flow
    sessionStore = memorySession();
    const sessionRecord: SessionRecord = {
      userId,
      subject: "gh|me-1",
      email: "me-alice@example.com",
      displayName: "Me Alice",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_me_test", sessionRecord, { ttlSeconds: 3600 });

    // 6. Gateway with sessionPlugin + mePlugin
    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(mePlugin, { identityClient });
      },
    });
    const gAddr = await gateway.listen();
    gatewayUrl = (typeof gAddr === "string" ? gAddr : `http://127.0.0.1:${gAddr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 120_000);

  afterAll(async () => {
    await gateway?.close();
    await identityServer?.close();
    await new Promise<void>((r) => jwksServer?.close(() => r()));
    await pg?.stop();
  });

  it("returns 401 when no session cookie", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/me`);
    expect(res.status).toBe(401);
  });

  it("returns user + teams for authenticated session", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/me`, {
      headers: { cookie: "lw-sid=sess_me_test" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      user: { id: string; email: string; subject: string; displayName: string };
      teams: unknown[];
    };
    expect(body.user.id).toBe(userId);
    expect(body.user.email).toBe("me-alice@example.com");
    expect(body.user.subject).toBe("gh|me-1");
    expect(body.user.displayName).toBe("Me Alice");
    expect(Array.isArray(body.teams)).toBe(true);
  });
});
