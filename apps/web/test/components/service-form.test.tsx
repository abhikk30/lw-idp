import type { paths } from "@lw-idp/contracts/gateway";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import createClient from "openapi-fetch";
import { Toaster } from "sonner";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

const pushMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: pushMock,
    replace: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
    prefetch: () => Promise.resolve(),
  }),
}));

// In jsdom, openapi-fetch's internal `new Request("/api/v1/...")` rejects relative
// URLs — replace the singleton client with one that uses an absolute base URL so
// MSW's `*/api/v1/services` pattern still matches.
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

import { ServiceForm } from "../../src/components/services/service-form.client.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
  pushMock.mockReset();
});
afterAll(() => server.close());

const teams = [
  { id: "11111111-1111-4111-8111-111111111111", slug: "platform-admins", name: "Platform Admins" },
  { id: "22222222-2222-4222-8222-222222222222", slug: "payments", name: "Payments" },
];

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ServiceForm teams={teams} />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("ServiceForm", () => {
  it("renders the required form fields", () => {
    renderForm();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^type$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^lifecycle$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/owner team/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /register service/i })).toBeInTheDocument();
  });

  it("shows validation error when slug is empty", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.clear(screen.getByLabelText(/slug/i));
    await user.click(screen.getByRole("button", { name: /register service/i }));
    await waitFor(() => {
      expect(screen.getByText(/slug is required/i)).toBeInTheDocument();
    });
  });

  it("submits valid form, posts to /api/v1/services with Idempotency-Key, redirects on success", async () => {
    const captured: { headers: Headers | null; body: unknown } = { headers: null, body: null };

    server.use(
      http.post("*/api/v1/services", async ({ request }) => {
        captured.headers = request.headers;
        captured.body = await request.json();
        const capturedBody = captured.body;
        return HttpResponse.json(
          {
            id: "svc-newly-created",
            slug: (capturedBody as { slug?: string }).slug ?? "x",
            name: (capturedBody as { name?: string }).name ?? "x",
            description: "",
            type: "service",
            lifecycle: "experimental",
            ownerTeamId: teams[0].id,
            repoUrl: "",
            tags: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "checkout");
    await user.type(screen.getByLabelText(/^name$/i), "Checkout");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/services/svc-newly-created");
    });

    expect(captured.headers?.get("Idempotency-Key")).toBeTruthy();
    expect((captured.body as { slug?: string }).slug).toBe("checkout");
  });

  it("normalizes comma-separated tags into an array", async () => {
    let capturedBody: unknown = null;

    server.use(
      http.post("*/api/v1/services", async ({ request }) => {
        capturedBody = await request.json();
        return HttpResponse.json(
          {
            id: "svc-tags",
            slug: "x",
            name: "X",
            description: "",
            type: "service",
            lifecycle: "experimental",
            ownerTeamId: teams[0].id,
            repoUrl: "",
            tags: (capturedBody as { tags?: string[] }).tags ?? [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "x");
    await user.type(screen.getByLabelText(/^name$/i), "X");
    await user.type(screen.getByLabelText(/^tags$/i), "go, payments, internal");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect((capturedBody as { tags?: string[] }).tags).toEqual(["go", "payments", "internal"]);
    });
  });

  it("shows toast on server error", async () => {
    server.use(
      http.post("*/api/v1/services", () =>
        HttpResponse.json({ message: "Slug already exists" }, { status: 409 }),
      ),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "dup");
    await user.type(screen.getByLabelText(/^name$/i), "Dup");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(screen.getByText(/slug already exists/i)).toBeInTheDocument();
    });
  });
});
