import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { IdentityService } from "@lw-idp/contracts/identity/v1";
import { connect, runMigrations } from "@lw-idp/db";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { type PgHandle, startPostgres } from "@lw-idp/testing";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";

const fakeVerifier = async (token: string) => {
  if (token === "good") {
    return {
      sub: "gh|42",
      email: "alice@example.com",
      name: "Alice Example",
      iss: "http://fake",
      aud: "lw-idp-gateway",
    };
  }
  throw new Error("invalid token");
};

describe("identity-svc Users gRPC handlers", () => {
  let pg: PgHandle;
  let db: PostgresJsDatabase;
  let server: LwIdpServer;
  let baseUrl: string;

  beforeAll(async () => {
    pg = await startPostgres({ database: "identity_test" });
    db = connect(pg.connectionString);
    await runMigrations(db, { migrationsFolder: "src/db/migrations" });

    server = await buildServer({
      name: "identity-svc",
      port: 0,
      register: async (fastify) => {
        await registerConnectRpc(fastify, { db, verifier: fakeVerifier });
      },
    });
    const addr = await server.listen();
    // fastify returns "http://0.0.0.0:PORT" when binding to 0.0.0.0 — replace for connect-node
    baseUrl = addr.replace("0.0.0.0", "127.0.0.1");
  }, 90_000);

  afterAll(async () => {
    await server?.close();
    await pg?.stop();
  });

  it("VerifyToken upserts a new user and returns it", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    const res = await client.verifyToken({ idToken: "good" });
    expect(res.user?.subject).toBe("gh|42");
    expect(res.user?.email).toBe("alice@example.com");
    expect(res.user?.displayName).toBe("Alice Example");
  });

  it("VerifyToken is idempotent on subject (second call returns same id)", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    const r1 = await client.verifyToken({ idToken: "good" });
    const r2 = await client.verifyToken({ idToken: "good" });
    expect(r1.user?.id).toBe(r2.user?.id);
  });

  it("VerifyToken with a bad token returns Unauthenticated", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    await expect(client.verifyToken({ idToken: "bad" })).rejects.toThrow(
      /unauthenticated|token|failed/i,
    );
  });

  it("ListUsers returns inserted users", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    const res = await client.listUsers({ limit: 10, pageToken: "" });
    expect(res.users.length).toBeGreaterThan(0);
    expect(res.users[0]?.subject).toBeTruthy();
  });

  it("GetUser returns an existing user by id", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    const list = await client.listUsers({ limit: 1, pageToken: "" });
    const id = list.users[0]?.id;
    const res = await client.getUser({ id });
    expect(res.user?.id).toBe(id);
  });

  it("GetUser returns NotFound for a missing id", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    await expect(client.getUser({ id: "00000000-0000-0000-0000-000000000000" })).rejects.toThrow(
      /not.?found/i,
    );
  });
});
