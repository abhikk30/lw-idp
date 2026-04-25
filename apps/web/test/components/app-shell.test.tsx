import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { Toaster } from "sonner";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { WebSocket as WsLibWebSocket } from "ws";
import { AppShell } from "../../src/components/app-shell.client.js";

// Topbar mounts CommandPalette which calls useRouter; the AppRouterContext is
// not provided in this isolated render, so stub the navigation hooks.
vi.mock("next/navigation", () => ({
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

beforeAll(() => {
  // EventStreamProvider opens a real WS — point it nowhere harmless and let
  // it fail-and-reconnect. We don't actually receive any frames in this
  // test; we only render the shell.
  (globalThis as unknown as { WebSocket: typeof WsLibWebSocket }).WebSocket = WsLibWebSocket;
});

// vitest with globals:false doesn't auto-cleanup RTL between tests, so the
// previous render's DOM leaks and breaks getByRole() (multiple matches).
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderShell() {
  const qc = new QueryClient();
  return render(
    <QueryClientProvider client={qc}>
      <AppShell user={{ displayName: "Alice", email: "alice@test" }}>
        <div data-testid="page-content">page</div>
      </AppShell>
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("AppShell", () => {
  it("renders the children inside main", () => {
    renderShell();
    expect(screen.getByTestId("page-content")).toBeInTheDocument();
  });

  it("renders the user displayName in the topbar", () => {
    renderShell();
    expect(screen.getByRole("button", { name: /user menu/i })).toHaveTextContent("Alice");
  });

  it("renders sidebar nav links to Dashboard, Services, Clusters, Teams, Settings", () => {
    renderShell();
    expect(screen.getByRole("link", { name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Services" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Clusters" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Teams" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Settings" })).toBeInTheDocument();
  });

  it("topbar has a banner role and a navigation toggle on mobile", () => {
    renderShell();
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /open navigation/i })).toBeInTheDocument();
  });
});
