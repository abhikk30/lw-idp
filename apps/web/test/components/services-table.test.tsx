import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import createClient from "openapi-fetch";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import {
  ServicesTable,
  type ServicesTableRow,
} from "../../src/components/services/services-table.client.js";

// ---------------------------------------------------------------------------
// Helpers for Argo CD application fixtures
// ---------------------------------------------------------------------------

function makeArgoApp(name: string, sync: string, health: string) {
  return {
    metadata: { name },
    status: {
      sync: { status: sync, revision: "abc1234" },
      health: { status: health, message: "" },
    },
  };
}

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
}));

// In jsdom, `new Request("/api/v1/...")` (used internally by openapi-fetch)
// rejects relative URLs — so we replace the singleton client with one that
// uses an absolute base URL. MSW pattern `*/api/v1/services` still matches.
const { mockedClient } = vi.hoisted(() => {
  return { mockedClient: { current: null as ReturnType<typeof createClient<paths>> | null } };
});
vi.mock("../../src/lib/api/client.js", () => ({
  apiClient: () => {
    if (!mockedClient.current) {
      mockedClient.current = createClient<paths>({ baseUrl: "http://localhost/api/v1" });
    }
    return mockedClient.current;
  },
}));

// Default handler: return an empty Argo CD app list so tests that don't care
// about deploy status don't produce MSW "unhandled request" warnings.
const server = setupServer(
  http.get("*/api/v1/argocd/applications", () => HttpResponse.json({ items: [] })),
);
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

const baseRow = (overrides: Partial<ServicesTableRow>): ServicesTableRow => ({
  id: "svc-1",
  slug: "checkout",
  name: "checkout",
  type: "service",
  lifecycle: "production",
  ownerTeamId: "t-1",
  updatedAt: "2026-04-20T00:00:00Z",
  ...overrides,
});

function renderTable(initialData: ServicesTableRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServicesTable initialData={initialData} />
    </QueryClientProvider>,
  );
}

describe("ServicesTable", () => {
  it("renders rows from initialData", () => {
    renderTable([
      baseRow({ id: "a", slug: "checkout-svc", name: "Checkout" }),
      baseRow({ id: "b", slug: "billing-svc", name: "Billing" }),
    ]);
    expect(screen.getByText("checkout-svc")).toBeInTheDocument();
    expect(screen.getByText("Checkout")).toBeInTheDocument();
    expect(screen.getByText("billing-svc")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data
  });

  it("typing in search triggers filtered fetch", async () => {
    server.use(
      http.get("*/api/v1/services", ({ request }) => {
        const url = new URL(request.url);
        const q = url.searchParams.get("q");
        if (q === "billing") {
          return HttpResponse.json({
            items: [
              {
                id: "svc-billing",
                slug: "billing",
                name: "Billing",
                type: "service",
                lifecycle: "production",
                ownerTeamId: "t-1",
                tags: [],
                createdAt: "2026-01-01T00:00:00Z",
                updatedAt: "2026-04-01T00:00:00Z",
              },
            ],
            nextCursor: null,
          });
        }
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );

    const user = userEvent.setup();
    renderTable([baseRow({ id: "a", slug: "checkout" })]);
    const input = screen.getByLabelText(/search services/i);
    await user.type(input, "billing");

    await waitFor(
      () => {
        expect(screen.getByText("Billing")).toBeInTheDocument();
      },
      { timeout: 2000 },
    );
  });

  it("renders empty state when no rows and no filter", () => {
    renderTable([]);
    expect(screen.getByText(/no services yet/i)).toBeInTheDocument();
  });

  it("renders 'no matches' when filter yields zero rows", async () => {
    server.use(
      http.get("*/api/v1/services", () => HttpResponse.json({ items: [], nextCursor: null })),
    );
    const user = userEvent.setup();
    renderTable([baseRow({ id: "a", slug: "checkout" })]);
    await user.type(screen.getByLabelText(/search services/i), "zzznotfound");
    await waitFor(() => {
      expect(screen.getByText(/no services match your filters/i)).toBeInTheDocument();
    });
  });

  it("type filter changes the queryKey and refetches", async () => {
    let lastTypeQuery: string | null = null;
    server.use(
      http.get("*/api/v1/services", ({ request }) => {
        const url = new URL(request.url);
        lastTypeQuery = url.searchParams.get("type");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const user = userEvent.setup();
    renderTable([baseRow({ id: "a" })]);
    const select = screen.getByLabelText(/filter by type/i);
    await user.selectOptions(select, "library");
    await waitFor(() => {
      expect(lastTypeQuery).toBe("library");
    });
  });

  // ---------------------------------------------------------------------------
  // E5: DeployStatusPill tests
  // ---------------------------------------------------------------------------

  it("shows Synced+Healthy pill when Argo CD reports Synced and Healthy", async () => {
    server.use(
      http.get("*/api/v1/argocd/applications", () =>
        HttpResponse.json({
          items: [makeArgoApp("checkout", "Synced", "Healthy")],
        }),
      ),
    );

    renderTable([baseRow({ id: "svc-1", slug: "checkout", name: "Checkout" })]);

    await waitFor(() => {
      // Pill text contains both "Synced" and "Healthy"
      const pill = screen.getByLabelText("Deploy status: Synced and Healthy");
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent("Synced");
      expect(pill).toHaveTextContent("Healthy");
    });
  });

  it("shows '—' for a service not managed by Argo CD (no matching app)", async () => {
    server.use(
      http.get("*/api/v1/argocd/applications", () =>
        // Return an app for a different service — not "unmanaged-svc"
        HttpResponse.json({
          items: [makeArgoApp("other-service", "Synced", "Healthy")],
        }),
      ),
    );

    renderTable([baseRow({ id: "svc-2", slug: "unmanaged-svc", name: "Unmanaged" })]);

    await waitFor(() => {
      // The pill column should render the em-dash fallback
      const cell = screen.getByText("—");
      expect(cell).toBeInTheDocument();
    });
  });

  it("shows Degraded pill when app health is Degraded", async () => {
    server.use(
      http.get("*/api/v1/argocd/applications", () =>
        HttpResponse.json({
          items: [makeArgoApp("payments", "Synced", "Degraded")],
        }),
      ),
    );

    renderTable([baseRow({ id: "svc-3", slug: "payments", name: "Payments" })]);

    await waitFor(() => {
      const pill = screen.getByLabelText("Deploy status: Degraded");
      expect(pill).toBeInTheDocument();
      expect(pill).toHaveTextContent("Degraded");
    });
  });
});
