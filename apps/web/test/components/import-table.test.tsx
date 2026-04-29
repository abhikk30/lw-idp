import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import createClient from "openapi-fetch";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// jsdom rejects relative URLs in `new Request("/api/v1/...")`; reroute the
// openapi-fetch singleton through an absolute base so MSW patterns match.
const { mockedClient } = vi.hoisted(() => {
  return { mockedClient: { current: null as ReturnType<typeof createClient<paths>> | null } };
});
vi.mock("../../src/lib/api/client.js", () => ({
  apiClient: () => {
    if (!mockedClient.current) {
      mockedClient.current = createClient<paths>({
        baseUrl: "http://localhost/api/v1",
        credentials: "same-origin",
      });
    }
    return mockedClient.current;
  },
}));

import {
  type ImportCandidate,
  ImportTable,
  type ImportTeamRef,
} from "../../src/components/services/import-table.client.js";

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

const teams: ImportTeamRef[] = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "platform", name: "Platform" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "payments", name: "Payments" },
];

const sampleCandidates: ImportCandidate[] = [
  {
    name: "checkout",
    repoUrl: "https://github.com/org/checkout.git",
    targetRevision: "master",
    path: "charts/checkout",
    destinationNamespace: "lw-idp",
    sync: { status: "Synced", revision: "abc123" },
    health: { status: "Healthy" },
  },
  {
    name: "billing",
    repoUrl: "https://github.com/org/billing.git",
    targetRevision: "main",
    path: "deploy/helm",
    destinationNamespace: "lw-idp",
    sync: { status: "OutOfSync" },
    health: { status: "Degraded" },
  },
];

function renderTable(props: {
  initialCandidates?: ImportCandidate[];
  teams?: ImportTeamRef[];
}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ImportTable
        initialCandidates={props.initialCandidates ?? sampleCandidates}
        teams={props.teams ?? teams}
      />
    </QueryClientProvider>,
  );
}

describe("ImportTable", () => {
  it("renders one row per candidate with name, repo, branch, path, sync + health pills, and an Import button", () => {
    renderTable({});

    // Names (font-mono cell content)
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("billing")).toBeInTheDocument();

    // Repo URLs visible
    expect(screen.getByText("https://github.com/org/checkout.git")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/org/billing.git")).toBeInTheDocument();

    // Branches
    expect(screen.getByText("master")).toBeInTheDocument();
    expect(screen.getByText("main")).toBeInTheDocument();

    // Paths
    expect(screen.getByText("charts/checkout")).toBeInTheDocument();
    expect(screen.getByText("deploy/helm")).toBeInTheDocument();

    // Two sync pills, two health pills
    expect(screen.getAllByTestId("sync-pill")).toHaveLength(2);
    expect(screen.getAllByTestId("health-pill")).toHaveLength(2);

    // One Import button per row
    expect(screen.getByTestId("import-btn-checkout")).toBeInTheDocument();
    expect(screen.getByTestId("import-btn-billing")).toBeInTheDocument();
  });

  it("renders an empty state when there are no candidates", () => {
    renderTable({ initialCandidates: [] });
    expect(screen.getByTestId("import-empty-state")).toBeInTheDocument();
    expect(screen.getByText(/no orphans/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /back to services/i })).toHaveAttribute(
      "href",
      "/services",
    );
  });

  it("clicking Import POSTs /api/v1/services with derived body and transitions row to imported", async () => {
    const captured: { body: unknown; headers: Headers | null } = {
      body: null,
      headers: null,
    };
    server.use(
      http.post("*/api/v1/services", async ({ request }) => {
        captured.body = await request.json();
        captured.headers = request.headers;
        const slug = (captured.body as { slug?: string }).slug ?? "x";
        return HttpResponse.json(
          {
            id: "svc-imported",
            slug,
            name: (captured.body as { name?: string }).name ?? "x",
            type: "service",
            lifecycle: "experimental",
            ownerTeamId: teams[0].id,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderTable({});

    await user.click(screen.getByTestId("import-btn-checkout"));

    await waitFor(() => {
      expect(captured.body).not.toBeNull();
    });

    const body = captured.body as {
      slug: string;
      name: string;
      type: string;
      lifecycle: string;
      ownerTeamId: string;
      repoUrl?: string;
    };
    expect(body.slug).toBe("checkout");
    expect(body.name).toBe("checkout");
    expect(body.type).toBe("service");
    expect(body.lifecycle).toBe("experimental");
    expect(body.ownerTeamId).toBe(teams[0].id);
    expect(body.repoUrl).toBe("https://github.com/org/checkout.git");

    // Idempotency-Key header sent
    expect(captured.headers?.get("Idempotency-Key")).toBeTruthy();

    // Row transitions to "imported" — the only remaining row should be billing
    await waitFor(() => {
      expect(screen.queryByTestId("import-btn-checkout")).not.toBeInTheDocument();
    });
    // The other row is still there
    expect(screen.getByTestId("import-btn-billing")).toBeInTheDocument();
  });

  it("shows Failed: <msg> and a Retry button when the catalog POST fails", async () => {
    server.use(
      http.post("*/api/v1/services", () =>
        HttpResponse.json({ message: "Slug already exists" }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderTable({});

    await user.click(screen.getByTestId("import-btn-checkout"));

    await waitFor(() => {
      expect(screen.getByTestId("import-error-checkout")).toBeInTheDocument();
    });
    expect(screen.getByTestId("import-error-checkout").textContent).toMatch(
      /Failed: .*Slug already exists/i,
    );

    // Retry button still visible (label changes from "Import" to "Retry")
    const retryBtn = screen.getByTestId("import-btn-checkout");
    expect(retryBtn).toBeInTheDocument();
    expect(retryBtn.textContent).toMatch(/retry/i);
    expect(retryBtn).not.toBeDisabled();
  });

  it("disables Import buttons with a tooltip when the user has no teams", () => {
    renderTable({ teams: [] });
    const btn = screen.getByTestId("import-btn-checkout");
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute("title", "You must belong to a team to import services");
  });
});
