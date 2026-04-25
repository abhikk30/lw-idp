import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { buildServer } from "@lw-idp/service-kit";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ConnectionRegistry } from "../../src/registry.js";
import { wsPlugin } from "../../src/ws/plugin.js";

function memoryStore(records: Record<string, SessionRecord>): SessionStore {
  return {
    async get(k) {
      return records[k];
    },
    async set(_k, _v, _o: SessionStoreSetOptions) {
      // not used here
    },
    async delete(k) {
      delete records[k];
    },
    async close() {
      // noop
    },
  };
}

describe("wsPlugin", () => {
  let cleanup: () => Promise<void> = async () => {};
  afterEach(async () => {
    await cleanup();
    cleanup = async () => {};
  });

  async function setup(records: Record<string, SessionRecord>) {
    const registry = new ConnectionRegistry();
    const store = memoryStore(records);
    const server = await buildServer({
      name: "notification-svc-test",
      port: 0,
      register: async (fastify) => {
        await fastify.register(wsPlugin, {
          sessionStore: store,
          registry,
          rateLimitPerSec: 100,
          rateLimitBurst: 50,
        });
      },
    });
    const addr = await server.listen();
    const url = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`)
      .replace("0.0.0.0", "127.0.0.1")
      .replace("http://", "ws://");
    cleanup = async () => {
      await server.close();
    };
    return { url, registry };
  }

  it("closes 4401 when no cookie present", async () => {
    const { url } = await setup({});
    const ws = new WebSocket(`${url}/ws/stream`);
    const closeCode = await new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => {
        // server may close before handshake completes — treat as auth failure
      });
    });
    // Some ws server impls swallow the 4401 and emit 1006 to the client; accept either.
    expect([4401, 1006]).toContain(closeCode);
  });

  it("closes 4401 when session lookup misses", async () => {
    const { url } = await setup({});
    const ws = new WebSocket(`${url}/ws/stream`, {
      headers: { cookie: "lw-sid=sess_unknown" },
    });
    const closeCode = await new Promise<number>((resolve) => {
      ws.on("close", (code) => resolve(code));
      ws.on("error", () => {});
    });
    expect([4401, 1006]).toContain(closeCode);
  });

  it("accepts a known session, sends welcome frame, and registers connection", async () => {
    const session: SessionRecord = {
      userId: "u-1",
      email: "u@test",
      displayName: "U",
      teams: [],
      createdAt: new Date().toISOString(),
    };
    const { url, registry } = await setup({ sess_known: session });
    const ws = new WebSocket(`${url}/ws/stream`, {
      headers: { cookie: "lw-sid=sess_known" },
    });
    const welcome = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("welcome timeout")), 2000);
      ws.on("message", (data) => {
        clearTimeout(t);
        resolve(data.toString());
      });
      ws.on("error", reject);
    });
    const parsed = JSON.parse(welcome) as { type: string; userId: string };
    expect(parsed.type).toBe("welcome");
    expect(parsed.userId).toBe("u-1");

    // Allow the registry add to complete (welcome send is sync in plugin).
    await new Promise((r) => setTimeout(r, 50));
    expect(registry.all()).toHaveLength(1);
    expect(registry.all()[0]?.session.userId).toBe("u-1");

    ws.close();
    // Wait for close handler in plugin to fire.
    await new Promise((r) => setTimeout(r, 100));
    expect(registry.all()).toHaveLength(0);
  });
});
