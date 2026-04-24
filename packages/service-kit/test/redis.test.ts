import { Redis } from "ioredis";
import { describe, expect, it } from "vitest";
import { createRedis } from "../src/index.js";

describe("createRedis", () => {
  it("returns a Redis instance", () => {
    // Use lazyConnect so the factory doesn't try to dial a real server during the unit test.
    const client = createRedis("redis://127.0.0.1:6379", { lazyConnect: true });
    try {
      expect(client).toBeInstanceOf(Redis);
    } finally {
      client.disconnect();
    }
  });

  it("passes options through to the underlying ioredis client (lazyConnect)", () => {
    const client = createRedis("redis://127.0.0.1:6379", { lazyConnect: true });
    try {
      // With lazyConnect, ioredis stays in "wait" state until something triggers a connect.
      expect(client.status).toBe("wait");
    } finally {
      client.disconnect();
    }
  });
});
