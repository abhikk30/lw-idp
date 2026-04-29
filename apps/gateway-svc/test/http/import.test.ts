import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importPlugin } from "../../src/http/import.js";
import { sessionPlugin } from "../../src/middleware/session.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function memorySession(): SessionStore {
  const m = new Map<string, SessionRecord>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v, _o: SessionStoreSetOptions) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async close() {
      m.clear();
    },
  };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
}

type FakeFetchHandler = (call: RecordedCall) => Promise<Response> | Response;

function makeFakeFetch(): {
  recorded: RecordedCall[];
  setHandler: (h: FakeFetchHandler) => void;
  fetchImpl: typeof fetch;
} {
  const recorded: RecordedCall[] = [];
  let handler: FakeFetchHandler = () => new Response("{}", { status: 200 });

  const fetchImpl: typeof fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? {};
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) {
        headers[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") {
          headers[k.toLowerCase()] = v;
        }
      }
    }
    const call: RecordedCall = { url, method, headers };
    recorded.push(call);
    return handler(call);
  }) as typeof fetch;

  return {
    recorded,
    setHandler: (h) => {
      handler = h;
    },
    fetchImpl,
  };
}

/** Minimal fake catalog client. Only `listServices` is needed. */
interface FakeCatalogClient {
  listServices: (_req: Record<string, unknown>) => Promise<{ services: Array<{ slug: string }> }>;
}

function makeFakeCatalogClient(): {
  client: FakeCatalogClient;
  setListServicesImpl: (impl: () => Promise<{ services: Array<{ slug: string }> }>) => void;
} {
  let impl: () => Promise<{ services: Array<{ slug: string }> }> = async () => ({ services: [] });
  const client: FakeCatalogClient = {
    listServices: async (_req) => impl(),
  };
  return {
    client,
    setListServicesImpl: (newImpl) => {
      impl = newImpl;
    },
  };
}

/** Build a minimal Argo CD Application object for use in fake responses. */
function makeArgoApp(
  name: string,
  overrides?: {
    repoURL?: string;
    targetRevision?: string;
    path?: string;
    namespace?: string;
    syncStatus?: string;
    syncRevision?: string;
    healthStatus?: string;
  },
) {
  return {
    metadata: { name },
    spec: {
      source: {
        repoURL: overrides?.repoURL ?? `https://github.com/org/${name}`,
        targetRevision: overrides?.targetRevision ?? "HEAD",
        path: overrides?.path ?? `helm/${name}`,
      },
      destination: {
        namespace: overrides?.namespace ?? name,
      },
    },
    status: {
      sync: {
        status: overrides?.syncStatus ?? "Synced",
        revision: overrides?.syncRevision ?? "abc1234",
      },
      health: {
        status: overrides?.healthStatus ?? "Healthy",
      },
    },
  };
}

// ── test suite ────────────────────────────────────────────────────────────────

describe("gateway GET /api/v1/services/import-candidates", () => {
  const ARGOCD_BASE = "http://argocd-server.argocd.svc:80";
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let fake: ReturnType<typeof makeFakeFetch>;
  let catalogFake: ReturnType<typeof makeFakeCatalogClient>;

  beforeAll(async () => {
    sessionStore = memorySession();

    // Session WITH idToken — happy path.
    await sessionStore.set(
      "sess_import_ok",
      {
        userId: "u_import_test",
        email: "import@test.com",
        displayName: "Import Tester",
        teams: [],
        idToken: "fake.jwt.token",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    // Session WITHOUT idToken — exercises the `reauth_required` branch.
    await sessionStore.set(
      "sess_import_noidt",
      {
        userId: "u_import_noidt",
        email: "import-noidt@test.com",
        displayName: "Import No IdToken",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    fake = makeFakeFetch();
    catalogFake = makeFakeCatalogClient();

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(importPlugin, {
          argocdApiUrl: ARGOCD_BASE,
          fetchImpl: fake.fetchImpl,
          // biome-ignore lint/suspicious/noExplicitAny: fake catalog client for testing
          catalogClient: catalogFake.client as any,
        });
      },
    });
    const addr = await gateway.listen();
    gatewayUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 60_000);

  afterAll(async () => {
    await gateway?.close();
    await sessionStore?.close();
  });

  beforeEach(() => {
    fake.recorded.length = 0;
    fake.setHandler(() => new Response("{}", { status: 200 }));
    catalogFake.setListServicesImpl(async () => ({ services: [] }));
  });

  const okCookie = { cookie: "lw-sid=sess_import_ok" };
  const noIdtCookie = { cookie: "lw-sid=sess_import_noidt" };

  // ── T1: happy path with set difference ────────────────────────────────────

  it("returns 4 candidates when Argo CD has 6 apps and catalog has 2 registered", async () => {
    const argoApps = [
      makeArgoApp("gateway-svc"),
      makeArgoApp("identity-svc"),
      makeArgoApp("catalog-svc"),
      makeArgoApp("cluster-svc"),
      makeArgoApp("notification-svc"),
      makeArgoApp("web"),
    ];

    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: argoApps }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    catalogFake.setListServicesImpl(async () => ({
      services: [{ slug: "gateway-svc" }, { slug: "identity-svc" }],
    }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      candidates: Array<{
        name: string;
        repoUrl: string;
        targetRevision: string;
        path: string;
        destinationNamespace: string;
        sync: { status: string; revision?: string };
        health: { status: string };
      }>;
    };

    expect(body.candidates).toHaveLength(4);

    const names = body.candidates.map((c) => c.name).sort();
    expect(names).toEqual(["catalog-svc", "cluster-svc", "notification-svc", "web"].sort());

    // Spot-check one candidate's shape.
    const catalogSvc = body.candidates.find((c) => c.name === "catalog-svc");
    expect(catalogSvc).toBeDefined();
    expect(catalogSvc?.repoUrl).toBe("https://github.com/org/catalog-svc");
    expect(catalogSvc?.targetRevision).toBe("HEAD");
    expect(catalogSvc?.path).toBe("helm/catalog-svc");
    expect(catalogSvc?.destinationNamespace).toBe("catalog-svc");
    expect(catalogSvc?.sync.status).toBe("Synced");
    expect(catalogSvc?.health.status).toBe("Healthy");

    // Verify Argo CD was called with correct URL and bearer.
    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.url).toBe(
      `${ARGOCD_BASE}/api/v1/applications?selector=${encodeURIComponent("app.kubernetes.io/part-of=lw-idp")}`,
    );
    expect(call.headers.authorization).toBe("Bearer fake.jwt.token");
  });

  // ── T2: all apps already in catalog → empty candidates ────────────────────

  it("returns empty candidates array when all Argo CD apps are already in the catalog", async () => {
    const argoApps = [makeArgoApp("gateway-svc"), makeArgoApp("identity-svc")];

    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: argoApps }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    catalogFake.setListServicesImpl(async () => ({
      services: [{ slug: "gateway-svc" }, { slug: "identity-svc" }],
    }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(0);
  });

  // ── T3: catalog services without an Argo CD app don't appear in candidates ─

  it("does not include catalog-only services (no Argo CD app) in candidates", async () => {
    // Only one Argo CD app, catalog has that app plus two extras.
    const argoApps = [makeArgoApp("real-app")];

    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: argoApps }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    catalogFake.setListServicesImpl(async () => ({
      services: [{ slug: "real-app" }, { slug: "catalog-only-1" }, { slug: "catalog-only-2" }],
    }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: Array<{ name: string }> };
    // real-app is in catalog, so it's excluded.
    // catalog-only-{1,2} are never in candidates (we only surface Argo CD orphans).
    expect(body.candidates).toHaveLength(0);
  });

  // ── T4: Argo CD upstream 5xx → IDP 503 deploy_plane_unavailable ───────────

  it("maps Argo CD 5xx to IDP 503 deploy_plane_unavailable", async () => {
    fake.setHandler(() => new Response("{}", { status: 503 }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("deploy_plane_unavailable");
  });

  // ── T5: missing idToken → IDP 401 reauth_required ────────────────────────

  it("returns 401 reauth_required when session has no idToken and does NOT call upstream", async () => {
    fake.setHandler(() => {
      throw new Error("upstream should not be called");
    });

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: noIdtCookie,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("reauth_required");
    expect(fake.recorded).toHaveLength(0);
  });

  // ── T6: catalog gRPC throws → IDP 502 catalog_unavailable ────────────────

  it("returns 502 catalog_unavailable when catalog gRPC call throws", async () => {
    // Argo CD responds fine.
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: [makeArgoApp("some-app")] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    // Catalog throws.
    catalogFake.setListServicesImpl(async () => {
      throw new Error("catalog gRPC connection refused");
    });

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("catalog_unavailable");
  });

  // ── T7: no session → 401 unauthorized ─────────────────────────────────────

  it("returns 401 unauthorized when there is no session cookie at all", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`);
    expect(res.status).toBe(401);
    expect(fake.recorded).toHaveLength(0);
  });

  // ── T8: both sources empty → 200 with empty candidates ────────────────────

  it("returns 200 with empty candidates when both Argo CD and catalog return nothing", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    catalogFake.setListServicesImpl(async () => ({ services: [] }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidates: unknown[] };
    expect(body.candidates).toHaveLength(0);
  });

  // ── T9: Argo CD upstream 401 → IDP 401 reauth_required ──────────────────

  it("maps Argo CD upstream 401 to IDP 401 reauth_required", async () => {
    fake.setHandler(() => new Response("{}", { status: 401 }));

    const res = await fetch(`${gatewayUrl}/api/v1/services/import-candidates`, {
      headers: okCookie,
    });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("reauth_required");
  });
});
