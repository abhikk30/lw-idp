import { type RedisHandle, startRedis } from "@lw-idp/testing";
import { Redis } from "ioredis";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { type SessionRecord, createRedisSessionStore } from "../src/index.js";

describe("redisSessionStore", () => {
  let redis: RedisHandle;
  let store: ReturnType<typeof createRedisSessionStore>;

  beforeAll(async () => {
    redis = await startRedis();
    store = createRedisSessionStore({ url: redis.url });
  }, 90_000);

  afterAll(async () => {
    await store?.close();
    await redis?.stop();
  });

  it("set + get round-trips a session record", async () => {
    const rec: SessionRecord = {
      userId: "u_1",
      email: "a@b.com",
      displayName: "Alice",
      teams: [{ id: "t_1", slug: "platform", name: "Platform" }],
      createdAt: new Date().toISOString(),
    };
    await store.set("sess_abc", rec, { ttlSeconds: 60 });
    const got = await store.get("sess_abc");
    expect(got).toEqual(rec);
  });

  it("returns undefined for missing keys", async () => {
    expect(await store.get("nope")).toBeUndefined();
  });

  it("round-trips an idToken when present (P2.0 Argo CD bearer)", async () => {
    const rec: SessionRecord = {
      userId: "u_with_token",
      email: "tok@b.com",
      displayName: "Token Holder",
      teams: [],
      idToken: "eyJhbGciOi.fakejwt.payload",
      createdAt: new Date().toISOString(),
    };
    await store.set("sess_with_id", rec, { ttlSeconds: 60 });
    const got = await store.get("sess_with_id");
    expect(got?.idToken).toBe("eyJhbGciOi.fakejwt.payload");
  });

  it("treats idToken as optional (legacy P1.x sessions still load)", async () => {
    const rec: SessionRecord = {
      userId: "u_no_token",
      email: "legacy@b.com",
      displayName: "Legacy",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    await store.set("sess_no_id", rec, { ttlSeconds: 60 });
    const got = await store.get("sess_no_id");
    expect(got?.idToken).toBeUndefined();
    expect(got?.email).toBe("legacy@b.com");
  });

  it("delete removes the session", async () => {
    await store.set(
      "sess_del",
      {
        userId: "u_d",
        email: "d@x",
        displayName: "D",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 60 },
    );
    await store.delete("sess_del");
    expect(await store.get("sess_del")).toBeUndefined();
  });

  it("honors TTL (short-lived key expires)", async () => {
    await store.set(
      "sess_ttl",
      {
        userId: "u_t",
        email: "t@x",
        displayName: "T",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 1 },
    );
    expect(await store.get("sess_ttl")).not.toBeUndefined();
    await new Promise((r) => setTimeout(r, 1_300));
    expect(await store.get("sess_ttl")).toBeUndefined();
  });

  it("namespaces keys with a prefix to avoid collisions", async () => {
    const alt = createRedisSessionStore({ url: redis.url, keyPrefix: "other:" });
    await alt.set(
      "sess_x",
      {
        userId: "u_x",
        email: "x",
        displayName: "X",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 60 },
    );
    // Same key in default prefix is missing
    expect(await store.get("sess_x")).toBeUndefined();
    // Alt namespace finds it
    expect(await alt.get("sess_x")).not.toBeUndefined();
    await alt.close();
  });

  it("does not close an externally-provided client on store.close()", async () => {
    const externalClient = new Redis(redis.url);
    // Wait for the client to be ready so we can assert status transitions below.
    await new Promise<void>((resolve, reject) => {
      if (externalClient.status === "ready") {
        resolve();
        return;
      }
      externalClient.once("ready", () => resolve());
      externalClient.once("error", reject);
    });
    expect(externalClient.status).toBe("ready");

    const externalStore = createRedisSessionStore({ client: externalClient });
    await externalStore.set(
      "sess_ext",
      {
        userId: "u_ext",
        email: "e@x",
        displayName: "E",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 60 },
    );
    expect(await externalStore.get("sess_ext")).not.toBeUndefined();

    await externalStore.close();
    // Ownership contract: when `client` is passed in, the store must NOT close it.
    expect(externalClient.status).toBe("ready");

    // The external client is still usable after the store is closed.
    await externalClient.set("probe:after-close", "1");
    expect(await externalClient.get("probe:after-close")).toBe("1");
    await externalClient.quit();
  });
});
