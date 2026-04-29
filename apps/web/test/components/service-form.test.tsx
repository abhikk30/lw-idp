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

/** Stand-in catalog response. Body is echoed for slug/name. */
function catalogHandler(captured?: {
  headers: Headers | null;
  body: unknown;
}) {
  return http.post("*/api/v1/services", async ({ request }) => {
    const body = await request.json();
    if (captured) {
      captured.headers = request.headers;
      captured.body = body;
    }
    const slug = (body as { slug?: string }).slug ?? "x";
    return HttpResponse.json(
      {
        id: "svc-newly-created",
        slug,
        name: (body as { name?: string }).name ?? "x",
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
  });
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

    server.use(catalogHandler(captured));

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

  // ---------------------------------------------------------------------------
  // T4: Argo CD optional fields + chained Application create
  // ---------------------------------------------------------------------------

  it("argo CD section is hidden by default and toggles open on click", async () => {
    const user = userEvent.setup();
    renderForm();

    expect(screen.queryByLabelText(/git repo url/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /argo cd/i }));

    expect(screen.getByLabelText(/git repo url/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/git branch/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/chart path/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/target namespace/i)).toBeInTheDocument();
  });

  it("submitted with no Argo CD fields → only catalog POST called, success toast", async () => {
    let argoCalled = false;
    server.use(
      catalogHandler(),
      http.post("*/api/v1/argocd/applications", () => {
        argoCalled = true;
        return HttpResponse.json({}, { status: 201 });
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

    expect(argoCalled).toBe(false);
    expect(screen.getByText(/registered/i)).toBeInTheDocument();
  });

  it("submitted with gitRepoUrl → both POSTs called with correct bodies + success toast", async () => {
    const captured: { argo: unknown } = { argo: null };
    server.use(
      catalogHandler(),
      http.post("*/api/v1/argocd/applications", async ({ request }) => {
        captured.argo = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "checkout");
    await user.type(screen.getByLabelText(/^name$/i), "Checkout");
    await user.click(screen.getByRole("button", { name: /argo cd/i }));
    await user.type(screen.getByLabelText(/git repo url/i), "https://github.com/org/checkout.git");
    await user.type(screen.getByLabelText(/git branch/i), "main");
    await user.type(screen.getByLabelText(/chart path/i), "deploy/helm");
    await user.type(screen.getByLabelText(/target namespace/i), "lw-idp-checkout");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(captured.argo).not.toBeNull();
    });

    const argo = captured.argo as {
      metadata: { name: string; namespace: string; labels: Record<string, string> };
      spec: {
        project: string;
        source: {
          repoURL: string;
          targetRevision: string;
          path: string;
          helm: { valueFiles: string[] };
        };
        destination: { server: string; namespace: string };
        syncPolicy: {
          automated: { prune: boolean; selfHeal: boolean };
          syncOptions: string[];
        };
      };
    };
    expect(argo.metadata.name).toBe("checkout");
    expect(argo.metadata.namespace).toBe("argocd");
    expect(argo.metadata.labels["app.kubernetes.io/part-of"]).toBe("lw-idp");
    expect(argo.spec.project).toBe("default");
    expect(argo.spec.source.repoURL).toBe("https://github.com/org/checkout.git");
    expect(argo.spec.source.targetRevision).toBe("main");
    expect(argo.spec.source.path).toBe("deploy/helm");
    expect(argo.spec.source.helm.valueFiles).toEqual(["values.yaml"]);
    expect(argo.spec.destination.server).toBe("https://kubernetes.default.svc");
    expect(argo.spec.destination.namespace).toBe("lw-idp-checkout");
    expect(argo.spec.syncPolicy.automated).toEqual({ prune: false, selfHeal: true });
    expect(argo.spec.syncPolicy.syncOptions).toEqual([
      "CreateNamespace=true",
      "ApplyOutOfSyncOnly=true",
    ]);

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/services/svc-newly-created");
    });
    expect(screen.getByText(/argo cd application created/i)).toBeInTheDocument();
  });

  it("default-fill: gitRepoUrl set + others blank → branch=master, path=charts/{slug}, ns=lw-idp", async () => {
    const captured: { argo: unknown } = { argo: null };
    server.use(
      catalogHandler(),
      http.post("*/api/v1/argocd/applications", async ({ request }) => {
        captured.argo = await request.json();
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "checkout");
    await user.type(screen.getByLabelText(/^name$/i), "Checkout");
    await user.click(screen.getByRole("button", { name: /argo cd/i }));
    await user.type(screen.getByLabelText(/git repo url/i), "https://github.com/org/checkout.git");
    // Leave branch / path / namespace blank.
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(captured.argo).not.toBeNull();
    });

    const argo = captured.argo as {
      spec: {
        source: { targetRevision: string; path: string };
        destination: { namespace: string };
      };
    };
    expect(argo.spec.source.targetRevision).toBe("master");
    expect(argo.spec.source.path).toBe("charts/checkout");
    expect(argo.spec.destination.namespace).toBe("lw-idp");
  });

  it("catalog POST fails → no Argo CD POST, error toast", async () => {
    let argoCalled = false;
    server.use(
      http.post("*/api/v1/services", () =>
        HttpResponse.json({ message: "Slug already exists" }, { status: 409 }),
      ),
      http.post("*/api/v1/argocd/applications", () => {
        argoCalled = true;
        return HttpResponse.json({}, { status: 201 });
      }),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "checkout");
    await user.type(screen.getByLabelText(/^name$/i), "Checkout");
    await user.click(screen.getByRole("button", { name: /argo cd/i }));
    await user.type(screen.getByLabelText(/git repo url/i), "https://github.com/org/checkout.git");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(screen.getByText(/slug already exists/i)).toBeInTheDocument();
    });
    expect(argoCalled).toBe(false);
    expect(pushMock).not.toHaveBeenCalled();
  });

  it("catalog POST succeeds, Argo CD POST fails → partial-success toast, no throw, redirect still happens", async () => {
    server.use(
      catalogHandler(),
      http.post("*/api/v1/argocd/applications", () =>
        HttpResponse.json({ message: "argocd is unreachable" }, { status: 502 }),
      ),
    );

    const user = userEvent.setup();
    renderForm();

    await user.type(screen.getByLabelText(/slug/i), "checkout");
    await user.type(screen.getByLabelText(/^name$/i), "Checkout");
    await user.click(screen.getByRole("button", { name: /argo cd/i }));
    await user.type(screen.getByLabelText(/git repo url/i), "https://github.com/org/checkout.git");
    await user.click(screen.getByRole("button", { name: /register service/i }));

    await waitFor(() => {
      expect(screen.getByText(/registered but argo cd application failed/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/argocd is unreachable/i)).toBeInTheDocument();

    // Catalog row stays — redirect still happens.
    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith("/services/svc-newly-created");
    });
  });
});
