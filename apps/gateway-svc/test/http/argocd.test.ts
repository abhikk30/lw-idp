import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { argocdPlugin } from "../../src/http/argocd.js";
import { sessionPlugin } from "../../src/middleware/session.js";

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
  body?: unknown;
}

type FakeFetchHandler = (call: RecordedCall) => Promise<Response> | Response;

/**
 * Build a fake `fetchImpl` that:
 *  - records every call into `recorded`
 *  - delegates to a swappable per-test handler
 */
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
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { url, method, headers, body };
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

describe("gateway /api/v1/argocd/*", () => {
  const ARGOCD_BASE = "http://argocd-server.argocd.svc:80";
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let fake: ReturnType<typeof makeFakeFetch>;

  beforeAll(async () => {
    sessionStore = memorySession();

    // Session WITH idToken — the happy path.
    await sessionStore.set(
      "sess_argo_ok",
      {
        userId: "u_argo_test",
        email: "argo@test.com",
        displayName: "Argo Tester",
        teams: [],
        idToken: "fake.jwt.token",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    // Session WITHOUT idToken — exercises the `reauth_required` branch even
    // though the session itself is valid.
    await sessionStore.set(
      "sess_argo_noidt",
      {
        userId: "u_argo_noidt",
        email: "argo-noidt@test.com",
        displayName: "Argo No IdToken",
        teams: [],
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    fake = makeFakeFetch();

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(argocdPlugin, {
          argocdApiUrl: ARGOCD_BASE,
          fetchImpl: fake.fetchImpl,
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
  });

  const okCookie = { cookie: "lw-sid=sess_argo_ok" };
  const noIdtCookie = { cookie: "lw-sid=sess_argo_noidt" };

  it("GET /applications forwards bearer + selector to upstream and proxies response", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ items: [{ metadata: { name: "svc-a" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: okCookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ metadata: { name: string } }> };
    expect(body.items[0].metadata.name).toBe("svc-a");

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.method).toBe("GET");
    expect(call.url).toBe(
      `${ARGOCD_BASE}/api/v1/applications?selector=${encodeURIComponent("app.kubernetes.io/part-of=lw-idp")}`,
    );
    expect(call.headers.authorization).toBe("Bearer fake.jwt.token");
  });

  it("GET /applications/:name forwards :name and bearer to upstream", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ metadata: { name: "foo" } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications/foo`, { headers: okCookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { metadata: { name: string } };
    expect(body.metadata.name).toBe("foo");

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.method).toBe("GET");
    expect(call.url).toBe(`${ARGOCD_BASE}/api/v1/applications/foo`);
    expect(call.headers.authorization).toBe("Bearer fake.jwt.token");
  });

  it("GET /applications/:name/resource-tree forwards correctly", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ nodes: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications/foo/resource-tree`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);

    expect(fake.recorded).toHaveLength(1);
    expect(fake.recorded[0].url).toBe(`${ARGOCD_BASE}/api/v1/applications/foo/resource-tree`);
    expect(fake.recorded[0].headers.authorization).toBe("Bearer fake.jwt.token");
  });

  it("POST /applications/:name/sync with empty body uses prune=false, force=false", async () => {
    fake.setHandler(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications/foo/sync`, {
      method: "POST",
      headers: { ...okCookie, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.method).toBe("POST");
    expect(call.url).toBe(`${ARGOCD_BASE}/api/v1/applications/foo/sync`);
    expect(call.headers.authorization).toBe("Bearer fake.jwt.token");
    expect(call.headers["content-type"]).toBe("application/json");
    expect(call.body).toEqual({
      prune: false,
      dryRun: false,
      strategy: { hook: { force: false } },
    });
  });

  it("POST /applications/:name/sync forwards prune=true, force=true when set", async () => {
    fake.setHandler(() => new Response(JSON.stringify({ ok: true }), { status: 200 }));

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications/foo/sync`, {
      method: "POST",
      headers: { ...okCookie, "content-type": "application/json" },
      body: JSON.stringify({ prune: true, force: true }),
    });
    expect(res.status).toBe(200);

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.body).toEqual({
      prune: true,
      dryRun: false,
      strategy: { hook: { force: true } },
    });
  });

  it("session without idToken returns 401 reauth_required and does NOT call upstream", async () => {
    fake.setHandler(() => {
      throw new Error("upstream should not be called");
    });

    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: noIdtCookie });
    expect(res.status).toBe(401);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("reauth_required");
    expect(fake.recorded).toHaveLength(0);
  });

  it("upstream errors map: 401->reauth_required, 403->argocd_forbidden, 404->not_found, 5xx->deploy_plane_unavailable, network->deploy_plane_unavailable", async () => {
    // 401
    fake.setHandler(() => new Response("{}", { status: 401 }));
    let res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: okCookie });
    expect(res.status).toBe(401);
    expect(((await res.json()) as { code: string }).code).toBe("reauth_required");

    // 403
    fake.setHandler(() => new Response("{}", { status: 403 }));
    res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: okCookie });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { code: string }).code).toBe("argocd_forbidden");

    // 404 (use the :name route so we exercise the parameterized message branch)
    fake.setHandler(() => new Response("{}", { status: 404 }));
    res = await fetch(`${gatewayUrl}/api/v1/argocd/applications/missing-app`, {
      headers: okCookie,
    });
    expect(res.status).toBe(404);
    const notFoundBody = (await res.json()) as { code: string; message: string };
    expect(notFoundBody.code).toBe("not_found");
    expect(notFoundBody.message).toContain("missing-app");

    // 5xx
    fake.setHandler(() => new Response("{}", { status: 503 }));
    res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: okCookie });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("deploy_plane_unavailable");

    // Network error (fetch throws)
    fake.setHandler(() => {
      throw new Error("ECONNREFUSED");
    });
    res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`, { headers: okCookie });
    expect(res.status).toBe(503);
    expect(((await res.json()) as { code: string }).code).toBe("deploy_plane_unavailable");
  });

  it("returns 401 unauthorized when no session cookie is present", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/argocd/applications`);
    expect(res.status).toBe(401);
    expect(fake.recorded).toHaveLength(0);
  });
});
