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
import { authPlugin } from "../../src/http/auth.js";
import { sessionPlugin } from "../../src/middleware/session.js";
import type { StateEntry, StateStore } from "../../src/services/state-store.js";

function memoryState(): StateStore {
  const m = new Map<string, StateEntry>();
  return {
    async put(k, v) {
      m.set(k, v);
    },
    async take(k) {
      const v = m.get(k);
      if (v) {
        m.delete(k);
      }
      return v;
    },
    async close() {
      m.clear();
    },
  };
}

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

describe("gateway /auth/login + /auth/callback", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let identityServer: LwIdpServer;
  let identityUrl: string;
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let dexServer: Server;
  let dexPort: number;
  let privateKey: KeyLike;
  let publicJwk: JWK;

  beforeAll(async () => {
    // 1. Postgres + identity-svc migrations
    pg = await startPostgres({ database: "gateway_auth_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "../identity-svc/src/db/migrations" });

    // 2. Fake Dex (JWKS + /token)
    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    publicJwk = { ...(await exportJWK(kp.publicKey)), alg: "RS256", kid: "b3-kid", use: "sig" };

    dexServer = createServer(async (req, res) => {
      if (req.url === "/keys") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (req.method === "POST" && req.url === "/token") {
        const issuer = `http://127.0.0.1:${dexPort}`;
        const token = await new SignJWT({
          email: "gateway-alice@example.com",
          name: "Gateway Alice",
        })
          .setProtectedHeader({ alg: "RS256", kid: "b3-kid" })
          .setIssuer(issuer)
          .setAudience("lw-idp-gateway")
          .setSubject("gh|gateway-1")
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
    dexPort = (dexServer.address() as AddressInfo).port;

    // 3. Verifier for identity-svc (also used by gateway's auth plugin)
    const verifier = createOidcVerifier({
      issuer: `http://127.0.0.1:${dexPort}`,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });

    // 4. Identity-svc in-process (real gRPC with real DB)
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

    // 5. Gateway with pre-seeded state (so we can jump straight to /auth/callback)
    const stateStore = memoryState();
    const sessionStore = memorySession();
    await stateStore.put("b3-state", { codeVerifier: "b3-verifier" });

    const identityClient = createIdentityClient(identityUrl);

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(authPlugin, {
          verifier,
          stateStore,
          sessionStore,
          identityClient,
          oidc: {
            issuer: `http://127.0.0.1:${dexPort}`,
            clientId: "lw-idp-gateway",
            clientSecret: "shh",
            redirectUri: "http://127.0.0.1/auth/callback",
            scopes: ["openid", "email", "profile"],
          },
          cookie: { secure: false, maxAgeSeconds: 3600 },
          sessionTtlSeconds: 3600,
          defaultRedirect: "/",
        });
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
    await new Promise<void>((r) => dexServer?.close(() => r()));
    await pg?.stop();
  });

  it("/auth/login redirects to Dex with PKCE + state", async () => {
    const res = await fetch(`${gatewayUrl}/auth/login`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain(`http://127.0.0.1:${dexPort}/auth?`);
    expect(loc).toMatch(/code_challenge=/);
    expect(loc).toMatch(/state=/);
  });

  it("/auth/callback exchanges code, verifies id_token, calls identity-svc.VerifyToken, sets cookie", async () => {
    const res = await fetch(`${gatewayUrl}/auth/callback?code=code-ok&state=b3-state`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^lw-sid=sess_/);
    expect(setCookie).toContain("HttpOnly");
  });

  it("/auth/callback with unknown state returns 400", async () => {
    const res = await fetch(`${gatewayUrl}/auth/callback?code=c&state=nope`, {
      redirect: "manual",
    });
    expect(res.status).toBe(400);
  });

  it("/auth/callback ignores unsafe redirectAfter and uses defaultRedirect", async () => {
    // Reach the same in-process state store the gateway plugin closed over by
    // pre-seeding a fresh state row whose redirectAfter is an attacker-controlled
    // absolute URL. isSafeRedirect should reject it and the response Location
    // should fall through to opts.defaultRedirect ("/").
    //
    // To preserve the closure over `stateStore`, we directly fetch /auth/login first
    // with the malicious redirect — that uses the SAME stateStore instance the
    // plugin holds and writes a state row we can subsequently complete via /callback.
    const loginRes = await fetch(
      `${gatewayUrl}/auth/login?redirect=${encodeURIComponent("https://evil.com")}`,
      { redirect: "manual" },
    );
    expect(loginRes.status).toBe(302);
    const dexLoc = loginRes.headers.get("location") ?? "";
    const stateMatch = dexLoc.match(/[?&]state=([^&]+)/);
    expect(stateMatch).not.toBeNull();
    const evilState = stateMatch?.[1] ?? "";

    const res = await fetch(`${gatewayUrl}/auth/callback?code=code-ok&state=${evilState}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location).toBe("/");
    expect(location).not.toContain("evil.com");
  });
});
