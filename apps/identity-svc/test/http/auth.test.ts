import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createOidcVerifier } from "@lw-idp/auth";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import { sql } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { type JWK, type KeyLike, SignJWT, exportJWK, generateKeyPair } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";
import { registerAuthRoutes } from "../../src/http/auth.js";
import { createStateStore } from "../../src/services/oidc.js";

describe("identity-svc /auth/login + /auth/callback", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let server: LwIdpServer;
  let baseUrl: string;
  let dexServer: Server;
  let dexPort: number;
  let privateKey: KeyLike;
  let publicJwk: JWK;
  let signedToken = "";
  const state = "state-one";

  beforeAll(async () => {
    pg = await startPostgres({ database: "identity_auth_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    const kp = await generateKeyPair("RS256");
    privateKey = kp.privateKey;
    publicJwk = {
      ...(await exportJWK(kp.publicKey)),
      alg: "RS256",
      kid: "test-kid",
      use: "sig",
    };

    dexServer = createServer(async (req, res) => {
      if (req.url === "/keys") {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      if (req.method === "POST" && req.url === "/token") {
        // Return a signed id_token keyed to a known subject
        const issuer = `http://127.0.0.1:${dexPort}`;
        const token = await new SignJWT({ email: "alice@example.com", name: "Alice" })
          .setProtectedHeader({ alg: "RS256", kid: "test-kid" })
          .setIssuer(issuer)
          .setAudience("lw-idp-gateway")
          .setSubject("gh|d2-user")
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(privateKey);
        signedToken = token;
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

    const verifier = createOidcVerifier({
      issuer: `http://127.0.0.1:${dexPort}`,
      audience: "lw-idp-gateway",
      jwksPath: "/keys",
    });
    const stateStore = createStateStore({ ttlMs: 60_000 });
    // Pre-seed state so we can call /auth/callback directly
    stateStore.put(state, { codeVerifier: "verifier-one" });

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
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    await new Promise<void>((r) => dexServer.close(() => r()));
    await pg?.stop();
  });

  it("/auth/login redirects to Dex authorize URL", async () => {
    const res = await fetch(`${baseUrl}/auth/login`, { redirect: "manual" });
    expect(res.status).toBe(302);
    const loc = res.headers.get("location") ?? "";
    expect(loc).toContain(`http://127.0.0.1:${dexPort}/auth?`);
    expect(loc).toContain("code_challenge=");
    expect(loc).toContain("state=");
  });

  it("/auth/callback exchanges code, verifies token, upserts user, sets cookie, redirects", async () => {
    const res = await fetch(`${baseUrl}/auth/callback?code=authcode&state=${state}`, {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^lw-sid=sess_/);
    expect(setCookie).toContain("HttpOnly");

    // User row should exist with the subject from the signed token
    const rows = await db.execute<{ subject: string; email: string }>(
      sql`SELECT subject, email FROM users WHERE subject = 'gh|d2-user'`,
    );
    expect(rows.length).toBe(1);
    expect(rows[0]?.email).toBe("alice@example.com");

    // A user_sessions row should also exist
    const sessionRows = await db.execute<{ id: string }>(
      sql`SELECT id FROM user_sessions WHERE id LIKE 'sess_%'`,
    );
    expect(sessionRows.length).toBeGreaterThanOrEqual(1);
    // signedToken was captured to verify the route actually received one
    expect(signedToken.length).toBeGreaterThan(10);
  });
});
