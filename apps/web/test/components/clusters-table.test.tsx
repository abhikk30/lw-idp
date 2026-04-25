import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import createClient from "openapi-fetch";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

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

// In jsdom, openapi-fetch's internal `new Request("/api/v1/...")` rejects relative
// URLs — replace the singleton client with one that uses an absolute base URL so
// MSW's `*/api/v1/clusters` pattern still matches.
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
  ClustersTable,
  type ClustersTableRow,
} from "../../src/components/clusters/clusters-table.client.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
});
afterAll(() => server.close());

const baseRow = (overrides: Partial<ClustersTableRow>): ClustersTableRow => ({
  id: "cl-1",
  slug: "prod-east",
  name: "Prod East",
  environment: "prod",
  region: "us-east-1",
  provider: "eks",
  createdAt: "2026-01-01T00:00:00Z",
  ...overrides,
});

function renderTable(initialData: ClustersTableRow[]) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClustersTable initialData={initialData} />
    </QueryClientProvider>,
  );
}

describe("ClustersTable", () => {
  it("renders rows from initialData", () => {
    renderTable([
      baseRow({ id: "a", slug: "prod-east" }),
      baseRow({ id: "b", slug: "staging", name: "Staging", environment: "stage" }),
    ]);
    expect(screen.getByText("prod-east")).toBeInTheDocument();
    expect(screen.getByText("staging")).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(3); // header + 2 data
  });

  it("filter by environment changes the queryKey and refetches", async () => {
    let lastEnv: string | null = null;
    server.use(
      http.get("*/api/v1/clusters", ({ request }) => {
        const url = new URL(request.url);
        lastEnv = url.searchParams.get("env");
        return HttpResponse.json({ items: [], nextCursor: null });
      }),
    );
    const user = userEvent.setup();
    renderTable([baseRow({ id: "a" })]);
    await user.selectOptions(screen.getByLabelText(/filter by environment/i), "prod");
    await waitFor(() => {
      expect(lastEnv).toBe("prod");
    });
  });

  it("renders empty state with no rows", () => {
    renderTable([]);
    expect(screen.getByText(/no clusters yet/i)).toBeInTheDocument();
  });
});
