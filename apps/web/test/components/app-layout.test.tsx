import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket as WsLibWebSocket } from "ws";
import AppLayout from "../../src/app/(app)/layout.js";

// Pin GATEWAY_INTERNAL_URL before the api/server.ts module is imported (it
// reads the env var once at module-init time). vi.hoisted runs before any
// `import` statement is resolved.
vi.hoisted(() => {
  process.env.GATEWAY_INTERNAL_URL = "http://test-gw.local/api/v1";
});

vi.mock("next/headers", () => ({
  headers: async () => new Map([["cookie", "lw-sid=sess_test"]]) as unknown as Headers,
}));

const { redirectSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn(() => {
    throw new Error("REDIRECT");
  }),
}));
vi.mock("next/navigation", () => ({
  redirect: redirectSpy,
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
  usePathname: () => "/",
}));

const server = setupServer();
beforeAll(() => {
  // EventStreamProvider opens a WS — point it at the ws lib so its constructor
  // doesn't throw under jsdom. We don't actually receive any frames.
  (globalThis as unknown as { WebSocket: typeof WsLibWebSocket }).WebSocket = WsLibWebSocket;
  server.listen();
});
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("AppLayout (RSC)", () => {
  it("renders AppShell with user when /me returns 200", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/me", () =>
        HttpResponse.json({
          user: { id: "u-1", subject: "gh|alice", email: "alice@test", displayName: "Alice" },
          teams: [],
        }),
      ),
    );

    // RSC components return JSX trees we can render.
    const ui = await AppLayout({ children: <div data-testid="kid">k</div> });
    const qc = new QueryClient();
    render(<QueryClientProvider client={qc}>{ui as React.ReactElement}</QueryClientProvider>);

    expect(screen.getByTestId("kid")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /user menu/i })).toHaveTextContent("Alice");
  });

  it("redirects to /auth/login when /me returns 401", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/me", () => new HttpResponse(null, { status: 401 })),
    );

    await expect(AppLayout({ children: <div>k</div> })).rejects.toThrow("REDIRECT");
    expect(redirectSpy).toHaveBeenCalledWith("/auth/login");
  });
});
