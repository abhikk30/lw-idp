import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import createClient from "openapi-fetch";
import { Toaster } from "sonner";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: refreshMock,
    prefetch: () => Promise.resolve(),
  }),
}));

// In jsdom, openapi-fetch's internal `new Request("/api/v1/...")` rejects relative
// URLs — replace the singleton client with one that uses an absolute base URL so
// MSW's `*/api/v1/services/...` pattern still matches.
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

import { ServiceEditForm } from "../../src/components/services/service-edit-form.client.js";

const teams = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "platform-admins", name: "Platform Admins" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "payments", name: "Payments" },
];

const baseService = {
  id: "svc-1",
  slug: "checkout",
  name: "Checkout",
  description: "old",
  type: "service" as const,
  lifecycle: "experimental" as const,
  ownerTeamId: teams[0].id,
  repoUrl: "https://github.com/foo/checkout",
  tags: ["go"],
  createdAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-04-20T00:00:00Z",
};

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
  refreshMock.mockReset();
});
afterAll(() => server.close());

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiceEditForm service={baseService} teams={teams} />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("ServiceEditForm", () => {
  it("hydrates with current service values", () => {
    renderForm();
    expect(screen.getByLabelText(/description/i)).toHaveValue("old");
    expect(screen.getByLabelText(/lifecycle/i)).toHaveValue("experimental");
    expect(screen.getByLabelText(/^tags$/i)).toHaveValue("go");
  });

  it("submits PATCH with idempotency-key, refreshes route, shows toast", async () => {
    const captured: { headers: Headers | null; body: unknown } = { headers: null, body: null };
    server.use(
      http.patch("*/api/v1/services/svc-1", async ({ request }) => {
        captured.headers = request.headers;
        captured.body = await request.json();
        return HttpResponse.json({
          ...baseService,
          description: "new",
          lifecycle: "production",
          updatedAt: new Date().toISOString(),
        });
      }),
    );

    const user = userEvent.setup();
    renderForm();
    const desc = screen.getByLabelText(/description/i);
    await user.clear(desc);
    await user.type(desc, "new");
    await user.selectOptions(screen.getByLabelText(/lifecycle/i), "production");
    await user.click(screen.getByRole("button", { name: /save changes/i }));

    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
    expect(captured.headers?.get("Idempotency-Key")).toBeTruthy();
    expect(captured.body).toMatchObject({ description: "new", lifecycle: "production" });
    await waitFor(() => {
      expect(screen.getByText(/service updated/i)).toBeInTheDocument();
    });
  });

  it("shows toast on PATCH error", async () => {
    server.use(
      http.patch("*/api/v1/services/svc-1", () =>
        HttpResponse.json({ message: "Forbidden" }, { status: 403 }),
      ),
    );

    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: /save changes/i }));
    await waitFor(() => {
      expect(screen.getByText(/forbidden/i)).toBeInTheDocument();
    });
  });
});
