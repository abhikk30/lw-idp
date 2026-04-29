import type { ArgoApplication } from "@lw-idp/contracts";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { Toaster } from "sonner";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { DeploymentsPanel } from "../../src/components/deployments/deployments-panel.client.js";

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
  usePathname: () => "/services/svc-1/deployments",
}));

// The real ArgoCdAdapter uses `globalThis.fetch` against relative URLs.
// jsdom's `new Request("/api/v1/...")` rejects relative URLs, so route the
// adapter via an absolute base. MSW pattern `*/api/v1/argocd/...` matches.
const { fetchAbs } = vi.hoisted(() => {
  return {
    fetchAbs: (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url =
        typeof input === "string" && input.startsWith("/") ? `http://localhost${input}` : input;
      return globalThis.fetch(url as RequestInfo, init);
    },
  };
});

vi.mock("../../src/lib/adapters/argocd.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/lib/adapters/argocd.js")>(
    "../../src/lib/adapters/argocd.js",
  );
  return {
    ...actual,
    createArgoCdAdapter: () => actual.createArgoCdAdapter(fetchAbs as typeof fetch),
  };
});

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

function makeApplication(overrides: Partial<ArgoApplication> = {}): ArgoApplication {
  return {
    name: "checkout",
    sync: { status: "Synced", revision: "abcdef0123456789" },
    health: { status: "Healthy", message: "" },
    replicas: { ready: 0, desired: 0 },
    lastSyncAt: "2026-04-26T11:30:00Z",
    operationPhase: "Succeeded",
    ...overrides,
  };
}

function renderPanel(initial: ArgoApplication) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <DeploymentsPanel initialApplication={initial} serviceSlug={initial.name} />
      <Toaster />
    </QueryClientProvider>,
  );
}

/**
 * Default getApplication handler — returns the same initial app so the
 * background refetch (initialData → refetch) doesn't error.
 */
function defaultGetHandler(initial: ArgoApplication): ReturnType<typeof http.get> {
  return http.get(`*/api/v1/argocd/applications/${initial.name}`, () =>
    HttpResponse.json({
      metadata: { name: initial.name },
      status: {
        sync: { status: initial.sync.status, revision: initial.sync.revision },
        health: { status: initial.health.status, message: initial.health.message },
        operationState: initial.lastSyncAt
          ? { phase: initial.operationPhase ?? "Succeeded", finishedAt: initial.lastSyncAt }
          : undefined,
      },
    }),
  );
}

describe("DeploymentsPanel", () => {
  it("renders revision SHA, Synced pill and Healthy pill from initialApplication", () => {
    const initial = makeApplication();
    server.use(defaultGetHandler(initial));
    renderPanel(initial);

    // short SHA (7 chars)
    expect(screen.getByText("abcdef0")).toBeInTheDocument();
    // sync + health pills
    expect(screen.getByLabelText(/sync status: synced/i)).toHaveTextContent("Synced");
    expect(screen.getByLabelText(/health status: healthy/i)).toHaveTextContent("Healthy");
    // replicas 0/0 → "—"
    expect(screen.getByText(/replicas:/i).parentElement).toHaveTextContent("—");
  });

  it("Sync button POSTs to /argocd/applications/:name/sync with empty body", async () => {
    const initial = makeApplication();
    let receivedBody: Record<string, unknown> | null = null;
    server.use(
      defaultGetHandler(initial),
      http.post(`*/api/v1/argocd/applications/${initial.name}/sync`, async ({ request }) => {
        receivedBody = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPanel(initial);

    await user.click(screen.getByRole("button", { name: /^sync$/i }));

    await waitFor(() => {
      expect(receivedBody).toEqual({ prune: false, force: false });
    });
    await waitFor(() => {
      expect(screen.getByText(/sync requested for checkout/i)).toBeInTheDocument();
    });
  });

  it("Hard Sync confirms via dialog → POSTs prune+force; Cancel does not call", async () => {
    const initial = makeApplication();
    let postCount = 0;
    let lastBody: Record<string, unknown> | null = null;
    server.use(
      defaultGetHandler(initial),
      http.post(`*/api/v1/argocd/applications/${initial.name}/sync`, async ({ request }) => {
        postCount += 1;
        lastBody = (await request.json()) as Record<string, unknown>;
        return new HttpResponse(null, { status: 202 });
      }),
    );
    const user = userEvent.setup();
    renderPanel(initial);

    // Open dialog
    await user.click(screen.getByRole("button", { name: /hard sync/i }));
    expect(await screen.findByText(/hard sync — checkout/i)).toBeInTheDocument();

    // Cancel — no POST
    await user.click(screen.getByRole("button", { name: /cancel/i }));
    expect(postCount).toBe(0);

    // Re-open + confirm
    await user.click(screen.getByRole("button", { name: /hard sync/i }));
    // Two "Hard Sync" buttons exist now (action bar + dialog confirm); click the
    // destructive one inside the dialog body.
    const dialog = await screen.findByRole("dialog");
    const confirm = dialog.querySelector(
      'button.bg-destructive, button[class*="destructive"]',
    ) as HTMLButtonElement | null;
    if (!confirm) {
      throw new Error("destructive confirm button not found in dialog");
    }
    await user.click(confirm);

    await waitFor(() => {
      expect(postCount).toBe(1);
    });
    expect(lastBody).toEqual({ prune: true, force: true });
    await waitFor(() => {
      expect(screen.getByText(/hard sync requested for checkout/i)).toBeInTheDocument();
    });
  });

  it("Degraded health renders destructive-styled pill", () => {
    const initial = makeApplication({
      health: { status: "Degraded", message: "ImagePullBackOff" },
    });
    server.use(defaultGetHandler(initial));
    renderPanel(initial);

    const pill = screen.getByLabelText(/health status: degraded/i);
    expect(pill).toHaveTextContent("Degraded");
    expect(pill.className).toMatch(/destructive/);
    // Message is also shown
    expect(screen.getByText(/ImagePullBackOff/)).toBeInTheDocument();
  });
});
