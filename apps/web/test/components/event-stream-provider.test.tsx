import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import WS, { WebSocketServer } from "ws";
import { EventStreamProvider } from "../../src/components/event-stream-provider.client.js";

// jsdom ships a broken WebSocket implementation (the underlying constructor
// throws "WebSocket is not a constructor"). Swap in the `ws` package's
// Node-side WebSocket so the EventStreamProvider can actually connect to
// the in-process WebSocketServer below.
beforeAll(() => {
  (globalThis as unknown as { WebSocket: typeof WS }).WebSocket = WS;
});

function startEchoServer(): Promise<{
  port: number;
  emit: (data: object) => void;
  close: () => void;
  closeAllWith: (code: number, reason: string) => void;
  connectionCount: () => number;
}> {
  return new Promise((resolve) => {
    const wss = new WebSocketServer({ port: 0 });
    wss.on("listening", () => {
      const port = (wss.address() as { port: number }).port;
      const sockets = new Set<import("ws").WebSocket>();
      let acceptedCount = 0;
      wss.on("connection", (sock) => {
        sockets.add(sock);
        acceptedCount += 1;
        sock.on("close", () => sockets.delete(sock));
        // welcome frame
        sock.send(
          JSON.stringify({
            type: "welcome",
            userId: "u-1",
            connectionId: 1,
            ts: new Date().toISOString(),
          }),
        );
      });
      resolve({
        port,
        emit: (data) => {
          for (const s of sockets) {
            if (s.readyState === s.OPEN) {
              s.send(JSON.stringify(data));
            }
          }
        },
        close: () => {
          for (const s of sockets) {
            s.close();
          }
          wss.close();
        },
        closeAllWith: (code, reason) => {
          for (const s of sockets) {
            s.close(code, reason);
          }
        },
        connectionCount: () => acceptedCount,
      });
    });
  });
}

afterEach(() => vi.clearAllMocks());

describe("EventStreamProvider", () => {
  it("invalidates services key on idp.catalog.service.created and shows toast", async () => {
    const server = await startEchoServer();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <EventStreamProvider url={`ws://127.0.0.1:${server.port}`} reconnectMaxMs={0}>
          <div>app</div>
        </EventStreamProvider>
        <Toaster />
      </QueryClientProvider>,
    );

    // Wait for "app" to render (provider wraps children unconditionally).
    expect(screen.getByText("app")).toBeInTheDocument();

    // Give the WS time to connect.
    await new Promise((r) => setTimeout(r, 100));

    server.emit({
      id: "01HX",
      type: "idp.catalog.service.created",
      entity: "service",
      action: "created",
      payload: { name: "checkout", slug: "checkout" },
      ts: new Date().toISOString(),
    });

    await waitFor(
      () => {
        expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ["services"] });
      },
      { timeout: 1500 },
    );

    // sonner renders toast text in the document
    await waitFor(
      () => {
        expect(screen.getByText(/checkout.*created/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    server.close();
  });

  it("ignores welcome frames", async () => {
    const server = await startEchoServer();
    const queryClient = new QueryClient();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    render(
      <QueryClientProvider client={queryClient}>
        <EventStreamProvider url={`ws://127.0.0.1:${server.port}`} reconnectMaxMs={0}>
          <div>app</div>
        </EventStreamProvider>
        <Toaster />
      </QueryClientProvider>,
    );

    await new Promise((r) => setTimeout(r, 200));

    expect(invalidateSpy).not.toHaveBeenCalled();
    server.close();
  });

  it("stops reconnect on 4xxx close code and surfaces session-expired toast", async () => {
    const server = await startEchoServer();
    const queryClient = new QueryClient();

    render(
      <QueryClientProvider client={queryClient}>
        <EventStreamProvider url={`ws://127.0.0.1:${server.port}`} reconnectMaxMs={5_000}>
          <div>app</div>
        </EventStreamProvider>
        <Toaster />
      </QueryClientProvider>,
    );

    // let connect
    await new Promise((r) => setTimeout(r, 100));

    // Close all server-side sockets with 4401 (unauthorized).
    server.closeAllWith(4401, "unauthorized");

    await waitFor(
      () => {
        expect(screen.getByText(/session expired/i)).toBeInTheDocument();
      },
      { timeout: 2000 },
    );

    // Wait an extra interval that would have triggered reconnect; assert no
    // additional connection attempts.
    const initialConns = server.connectionCount();
    await new Promise((r) => setTimeout(r, 1500));
    expect(server.connectionCount()).toBe(initialConns);

    server.close();
  });
});
