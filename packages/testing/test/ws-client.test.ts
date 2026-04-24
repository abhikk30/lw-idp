import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WebSocketServer } from "ws";
import { type WsClient, openWsClient } from "../src/ws-client.js";

describe("openWsClient", () => {
  let server: WebSocketServer;
  let url: string;
  let client: WsClient | undefined;

  beforeEach(() => {
    server = new WebSocketServer({ port: 0 });
    const addr = server.address() as AddressInfo;
    url = `ws://127.0.0.1:${addr.port}/ws/stream`;
  });

  afterEach(async () => {
    if (client) {
      await client.close().catch(() => {});
      client = undefined;
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("opens, sends, and receives a matching message", async () => {
    server.on("connection", (ws) => {
      ws.on("message", (data) => {
        // Echo with an envelope.
        const raw = data.toString();
        try {
          const parsed = JSON.parse(raw);
          ws.send(JSON.stringify({ echo: true, payload: parsed }));
        } catch {
          ws.send(JSON.stringify({ echo: true, payload: raw }));
        }
      });
    });

    client = openWsClient({ url });
    await client.opened;

    client.send({ hello: "world" });

    const start = Date.now();
    const msg = await client.waitFor<{ echo: boolean; payload: unknown }>(
      (m): m is { echo: boolean; payload: unknown } =>
        typeof m === "object" && m !== null && (m as { echo?: unknown }).echo === true,
      1_000,
    );
    const elapsed = Date.now() - start;

    expect(msg.echo).toBe(true);
    expect(msg.payload).toEqual({ hello: "world" });
    expect(elapsed).toBeLessThan(500);
  });

  it("rejects waitFor with a timeout when no matching message arrives", async () => {
    // Server accepts but never sends.
    server.on("connection", () => {
      /* no-op */
    });

    client = openWsClient({ url });
    await client.opened;

    const start = Date.now();
    await expect(client.waitFor(() => true, 150)).rejects.toThrow(/timeout/i);
    const elapsed = Date.now() - start;

    // Should reject close to the requested timeout, not hang forever.
    expect(elapsed).toBeGreaterThanOrEqual(140);
    expect(elapsed).toBeLessThan(1_000);
  });

  it("matches an already-buffered message when waitFor is called after arrival", async () => {
    server.on("connection", (ws) => {
      ws.send(JSON.stringify({ greeting: "hi" }));
    });

    client = openWsClient({ url });
    await client.opened;

    // Wait a tick so the first message is already in the buffer before waitFor.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(client.messages.length).toBeGreaterThanOrEqual(1);

    const msg = await client.waitFor<{ greeting: string }>(
      (m): m is { greeting: string } =>
        typeof m === "object" && m !== null && (m as { greeting?: unknown }).greeting === "hi",
      500,
    );
    expect(msg.greeting).toBe("hi");
  });
});
