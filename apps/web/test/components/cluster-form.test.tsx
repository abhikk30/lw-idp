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

import { ClusterForm } from "../../src/components/clusters/cluster-form.client.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => {
  server.resetHandlers();
  cleanup();
  pushMock.mockReset();
});
afterAll(() => server.close());

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <ClusterForm />
      <Toaster />
    </QueryClientProvider>,
  );
}

describe("ClusterForm", () => {
  it("renders required fields", () => {
    renderForm();
    expect(screen.getByLabelText(/slug/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^name$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^environment$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/^provider$/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/region/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/api endpoint/i)).toBeInTheDocument();
  });

  it("validates apiEndpoint must be https://", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/slug/i), "prod-east");
    await user.type(screen.getByLabelText(/^name$/i), "Prod East");
    await user.type(screen.getByLabelText(/region/i), "us-east-1");
    await user.type(screen.getByLabelText(/api endpoint/i), "http://kube.foo:6443");
    await user.click(screen.getByRole("button", { name: /register cluster/i }));
    await waitFor(() => {
      expect(screen.getByText(/must use https/i)).toBeInTheDocument();
    });
  });

  it("submits valid form, posts to /api/v1/clusters with Idempotency-Key, redirects on success", async () => {
    const captured: { headers: Headers | null; body: unknown } = { headers: null, body: null };
    server.use(
      http.post("*/api/v1/clusters", async ({ request }) => {
        captured.headers = request.headers;
        captured.body = await request.json();
        const body = captured.body as {
          slug?: string;
          name?: string;
          environment?: string;
          region?: string;
          provider?: string;
          apiEndpoint?: string;
        };
        return HttpResponse.json(
          {
            id: "cl-newly",
            slug: body.slug ?? "x",
            name: body.name ?? "x",
            environment: body.environment ?? "dev",
            region: body.region ?? "",
            provider: body.provider ?? "kind",
            apiEndpoint: body.apiEndpoint ?? "",
            createdAt: new Date().toISOString(),
          },
          { status: 201 },
        );
      }),
    );

    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText(/slug/i), "prod-east");
    await user.type(screen.getByLabelText(/^name$/i), "Prod East");
    await user.type(screen.getByLabelText(/region/i), "us-east-1");
    await user.type(screen.getByLabelText(/api endpoint/i), "https://kube.foo:6443");
    await user.click(screen.getByRole("button", { name: /register cluster/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/clusters/cl-newly");
    });
    expect(captured.headers?.get("Idempotency-Key")).toBeTruthy();
    expect((captured.body as { slug?: string }).slug).toBe("prod-east");
  });
});
