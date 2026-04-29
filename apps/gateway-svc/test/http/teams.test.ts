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
import { teamsPlugin } from "../../src/http/teams.js";
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

describe("gateway GET /api/v1/teams", () => {
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
  let seededTeamId: string;

  beforeAll(async () => {
    pg = await startPostgres({ database: "gateway_teams_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../identity-svc/src/db/migrations" });

    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    publicJwk = { ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "teams-kid", use: "sig" };

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

    const identityClient = createIdentityClient(identityUrl);

    const idToken = await new SignJWT({ email: "teams-alice@example.com", name: "Teams Alice" })
      .setProtectedHeader({ alg: "RS256", kid: "teams-kid" })
      .setIssuer(`http://127.0.0.1:${jwksPort}`)
      .setAudience("lw-idp-gateway")
      .setSubject("gh|teams-1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);
    const verifyResult = await identityClient.verifyToken({ idToken });
    if (!verifyResult.user) {
      throw new Error("identity.VerifyToken returned no user");
    }
    userId = verifyResult.user.id;

    // Seed a team so the list isn't empty.
    const created = await identityClient.createTeam({
      slug: "platform-test",
      name: "Platform Test",
    });
    if (!created.team) {
      throw new Error("identity.CreateTeam returned no team");
    }
    seededTeamId = created.team.id;

    sessionStore = memorySession();
    const sessionRecord: SessionRecord = {
      userId,
      subject: "gh|teams-1",
      email: "teams-alice@example.com",
      displayName: "Teams Alice",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set("sess_teams_test", sessionRecord, { ttlSeconds: 3600 });

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(teamsPlugin, { identityClient });
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
    const res = await fetch(`${gatewayUrl}/api/v1/teams`);
    expect(res.status).toBe(401);
  });

  it("returns the seeded team for an authenticated session", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/teams`, {
      headers: { cookie: "lw-sid=sess_teams_test" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      teams: Array<{ id: string; slug: string; name: string }>;
    };
    expect(Array.isArray(body.teams)).toBe(true);
    const found = body.teams.find((t) => t.id === seededTeamId);
    expect(found).toBeDefined();
    expect(found?.slug).toBe("platform-test");
    expect(found?.name).toBe("Platform Test");
  });
});
