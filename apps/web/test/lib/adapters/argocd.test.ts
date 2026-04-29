import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { createArgoCdAdapter } from "../../../src/lib/adapters/argocd.js";

// ---------------------------------------------------------------------------
// Shared upstream Argo CD fixture shapes
// ---------------------------------------------------------------------------

const upstreamApp1 = {
  metadata: { name: "catalog-svc" },
  status: {
    sync: { status: "Synced", revision: "abc1234" },
    health: { status: "Healthy" },
    operationState: { phase: "Succeeded", finishedAt: "2026-04-25T12:00:00Z" },
  },
};

const upstreamApp2 = {
  metadata: { name: "billing-svc" },
  status: {
    sync: { status: "OutOfSync", revision: "def5678" },
    health: { status: "Degraded", message: "CrashLoopBackOff" },
    operationState: { phase: "Failed", finishedAt: "2026-04-24T09:30:00Z" },
  },
};

// ---------------------------------------------------------------------------
// MSW server
// ---------------------------------------------------------------------------

const BASE = "http://localhost";

const server = setupServer(
  http.get(`${BASE}/api/v1/argocd/applications`, () =>
    HttpResponse.json({ items: [upstreamApp1, upstreamApp2] }),
  ),

  http.get(`${BASE}/api/v1/argocd/applications/catalog-svc`, () => HttpResponse.json(upstreamApp1)),

  http.get(`${BASE}/api/v1/argocd/applications/missing`, () =>
    HttpResponse.json(
      { code: "not_found", message: "argo cd application not found: missing" },
      { status: 404 },
    ),
  ),

  http.post<{ name: string }>(`${BASE}/api/v1/argocd/applications/:name/sync`, () =>
    HttpResponse.json({}, { status: 200 }),
  ),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

// ---------------------------------------------------------------------------
// Build adapter under test with a fetch that targets a localhost base URL so
// MSW can intercept it (MSW in Node intercepts all fetch calls regardless of
// host, but we need the full URL to differ from the default "/api/v1" relative
// path which wouldn't be resolvable in Node without a base).
// ---------------------------------------------------------------------------

function makeAdapter() {
  // Wrap globalThis.fetch so relative URLs become absolute for Node test env.
  const wrappedFetch: typeof fetch = (input, init) => {
    const url = typeof input === "string" && input.startsWith("/") ? `${BASE}${input}` : input;
    return globalThis.fetch(url as RequestInfo, init);
  };
  return createArgoCdAdapter(wrappedFetch);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ArgoCdAdapter — listApplications", () => {
  it("happy path: returns 2 trimmed ArgoApplications with correct field mapping", async () => {
    const adapter = makeAdapter();
    const apps = await adapter.listApplications();

    expect(apps).toHaveLength(2);

    const app1 = apps[0];
    expect(app1.name).toBe("catalog-svc");
    expect(app1.sync.status).toBe("Synced");
    expect(app1.sync.revision).toBe("abc1234");
    expect(app1.health.status).toBe("Healthy");
    expect(app1.health.message).toBe(""); // Argo CD omits message when Healthy → normalised
    expect(app1.operationPhase).toBe("Succeeded");
    expect(app1.lastSyncAt).toBe("2026-04-25T12:00:00Z");
    expect(app1.replicas).toEqual({ ready: 0, desired: 0 }); // 0/0 fallback

    const app2 = apps[1];
    expect(app2.name).toBe("billing-svc");
    expect(app2.sync.status).toBe("OutOfSync");
    expect(app2.health.status).toBe("Degraded");
    expect(app2.health.message).toBe("CrashLoopBackOff");
    expect(app2.operationPhase).toBe("Failed");
  });
});

describe("ArgoCdAdapter — getApplication", () => {
  it("happy path: returns one mapped ArgoApplication", async () => {
    const adapter = makeAdapter();
    const app = await adapter.getApplication("catalog-svc");

    expect(app.name).toBe("catalog-svc");
    expect(app.sync.status).toBe("Synced");
    expect(app.sync.revision).toBe("abc1234");
    expect(app.health.status).toBe("Healthy");
    expect(app.health.message).toBe("");
    expect(app.lastSyncAt).toBe("2026-04-25T12:00:00Z");
    expect(app.operationPhase).toBe("Succeeded");
  });

  it("upstream 404 — throws an error with status 404", async () => {
    const adapter = makeAdapter();
    await expect(adapter.getApplication("missing")).rejects.toMatchObject({ status: 404 });
  });
});

describe("ArgoCdAdapter — sync", () => {
  it("default opts — sends body { prune: false, force: false } and resolves", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/api/v1/argocd/applications/catalog-svc/sync`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const adapter = makeAdapter();
    await expect(adapter.sync("catalog-svc")).resolves.toBeUndefined();
    expect(receivedBody).toEqual({ prune: false, force: false });
  });

  it("hard sync opts — sends body { prune: true, force: true }", async () => {
    let receivedBody: unknown;
    server.use(
      http.post(`${BASE}/api/v1/argocd/applications/catalog-svc/sync`, async ({ request }) => {
        receivedBody = await request.json();
        return HttpResponse.json({}, { status: 200 });
      }),
    );

    const adapter = makeAdapter();
    await expect(
      adapter.sync("catalog-svc", { prune: true, force: true }),
    ).resolves.toBeUndefined();
    expect(receivedBody).toEqual({ prune: true, force: true });
  });

  it("upstream 503 (deploy_plane_unavailable) — adapter throws", async () => {
    server.use(
      http.post(`${BASE}/api/v1/argocd/applications/catalog-svc/sync`, () =>
        HttpResponse.json(
          { code: "deploy_plane_unavailable", message: "argo cd unavailable" },
          { status: 503 },
        ),
      ),
    );

    const adapter = makeAdapter();
    await expect(adapter.sync("catalog-svc")).rejects.toMatchObject({ status: 503 });
  });
});

describe("ArgoCdAdapter — field mapping edge cases", () => {
  it("missing health.message (Healthy) → normalised to empty string", async () => {
    // upstreamApp1 has no health.message — already covered, but be explicit
    server.use(
      http.get(`${BASE}/api/v1/argocd/applications/catalog-svc`, () =>
        HttpResponse.json({
          metadata: { name: "catalog-svc" },
          status: {
            sync: { status: "Synced", revision: "abc" },
            health: { status: "Healthy" },
            // no message field
          },
        }),
      ),
    );

    const adapter = makeAdapter();
    const app = await adapter.getApplication("catalog-svc");
    expect(app.health.message).toBe("");
  });

  it("missing operationState → operationPhase is undefined, lastSyncAt is undefined", async () => {
    server.use(
      http.get(`${BASE}/api/v1/argocd/applications/catalog-svc`, () =>
        HttpResponse.json({
          metadata: { name: "catalog-svc" },
          status: {
            sync: { status: "Synced", revision: "abc" },
            health: { status: "Healthy" },
            // no operationState
          },
        }),
      ),
    );

    const adapter = makeAdapter();
    const app = await adapter.getApplication("catalog-svc");
    expect(app.operationPhase).toBeUndefined();
    expect(app.lastSyncAt).toBeUndefined();
  });
});
