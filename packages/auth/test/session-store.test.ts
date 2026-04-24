import { type RedisHandle, startRedis } from "@lw-idp/testing";
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
});
