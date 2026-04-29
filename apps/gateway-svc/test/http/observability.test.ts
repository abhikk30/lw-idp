import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { observabilityPlugin } from "../../src/http/observability.js";
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

type RouteHandler = (
  url: string,
  method: string,
) => { status: number; body: unknown } | Promise<{ status: number; body: unknown }>;

interface StubServer {
  server: Server;
  baseUrl: string;
  setHandler(h: RouteHandler): void;
  capturedUrls: string[];
}

async function startStub(): Promise<StubServer> {
  const capturedUrls: string[] = [];
  let handler: RouteHandler = () => ({ status: 200, body: {} });
  const server = createServer(async (req, res) => {
    const url = req.url ?? "";
    capturedUrls.push(url);
    const result = await handler(url, req.method ?? "GET");
    res.statusCode = result.status;
    res.setHeader("content-type", "application/json");
    res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return {
    server,
    baseUrl: `http://127.0.0.1:${port}`,
    setHandler: (h) => {
      handler = h;
    },
    capturedUrls,
  };
}

describe("gateway /api/v1/observability/*", () => {
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let argo: StubServer;
  let loki: StubServer;
  let tempo: StubServer;
  let prom: StubServer;

  beforeAll(async () => {
    argo = await startStub();
    loki = await startStub();
    tempo = await startStub();
    prom = await startStub();

    sessionStore = memorySession();
    await sessionStore.set(
      "sess_obs_ok",
      {
        userId: "u_obs_test",
        email: "obs@test.com",
        displayName: "Obs Tester",
        teams: [],
        idToken: "fake.jwt.token",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(observabilityPlugin, {
          lokiUrl: loki.baseUrl,
          tempoUrl: tempo.baseUrl,
          promUrl: prom.baseUrl,
          argocdApiUrl: argo.baseUrl,
        });
      },
    });
    const addr = await gateway.listen();
    gatewayUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  });

  afterAll(async () => {
    await gateway?.close();
    await new Promise<void>((r) => argo?.server.close(() => r()));
    await new Promise<void>((r) => loki?.server.close(() => r()));
    await new Promise<void>((r) => tempo?.server.close(() => r()));
    await new Promise<void>((r) => prom?.server.close(() => r()));
  });

  // ---- Logs ----

  it("returns 401 without a session (logs)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/observability/logs?service=foo`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when service param is missing (logs)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/observability/logs`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("bad_request");
  });

  it("returns 200 and queries Loki with namespace from Argo CD App", async () => {
    argo.setHandler((url) => {
      if (url.startsWith("/api/v1/applications/sample-nginx")) {
        return {
          status: 200,
          body: { spec: { destination: { namespace: "sample-nginx" } } },
        };
      }
      return { status: 404, body: {} };
    });
    loki.setHandler(() => ({
      status: 200,
      body: {
        data: {
          result: [
            {
              stream: { namespace: "sample-nginx", pod: "sample-nginx-abc" },
              values: [["1714345200000000000", JSON.stringify({ level: "info", msg: "hi" })]],
            },
          ],
        },
      },
    }));

    const before = loki.capturedUrls.length;
    const res = await fetch(`${gatewayUrl}/api/v1/observability/logs?service=sample-nginx`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { lines: unknown[]; truncated: boolean };
    expect(Array.isArray(body.lines)).toBe(true);
    expect(body.lines).toHaveLength(1);

    const lokiUrl = loki.capturedUrls[before];
    expect(lokiUrl).toBeDefined();
    expect(decodeURIComponent(lokiUrl ?? "")).toContain('{namespace="sample-nginx"}');
  });

  it("appends trace_id filter to Loki query when trace_id is provided", async () => {
    argo.setHandler(() => ({
      status: 200,
      body: { spec: { destination: { namespace: "sample-nginx" } } },
    }));
    loki.setHandler(() => ({ status: 200, body: { data: { result: [] } } }));

    const before = loki.capturedUrls.length;
    const res = await fetch(
      `${gatewayUrl}/api/v1/observability/logs?service=sample-nginx&trace_id=abc123`,
      { headers: { cookie: "lw-sid=sess_obs_ok" } },
    );
    expect(res.status).toBe(200);

    // URLSearchParams encodes spaces as `+`. Replace before decoding so the
    // assertion can read the LogQL filter the way the client wrote it.
    const lokiUrl = loki.capturedUrls[before];
    const decoded = decodeURIComponent((lokiUrl ?? "").replace(/\+/g, " "));
    expect(decoded).toContain('| trace_id="abc123"');
  });

  it("returns 404 when Argo CD App does not exist", async () => {
    argo.setHandler(() => ({ status: 404, body: {} }));
    const res = await fetch(`${gatewayUrl}/api/v1/observability/logs?service=ghost`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("not_found");
  });

  it("returns 502 when Loki returns 5xx", async () => {
    argo.setHandler(() => ({
      status: 200,
      body: { spec: { destination: { namespace: "sample-nginx" } } },
    }));
    loki.setHandler(() => ({ status: 500, body: { error: "boom" } }));
    const res = await fetch(`${gatewayUrl}/api/v1/observability/logs?service=sample-nginx`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("loki_unreachable");
  });

  // ---- Trace search ----

  it("returns 401 without a session (traces)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces?service=foo`);
    expect(res.status).toBe(401);
  });

  it("returns 400 when service param is missing (traces)", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 and proxies trace search to Tempo", async () => {
    tempo.setHandler(() => ({
      status: 200,
      body: {
        traces: [
          {
            traceID: "deadbeef",
            rootServiceName: "sample-nginx",
            rootTraceName: "GET /",
            startTimeUnixNano: "1714345200000000000",
            durationMs: 12,
            spanSet: { spans: [{ status: "STATUS_CODE_OK" }] },
          },
        ],
      },
    }));

    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces?service=sample-nginx`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { traces: { trace_id: string }[] };
    expect(body.traces).toHaveLength(1);
    expect(body.traces[0]?.trace_id).toBe("deadbeef");
  });

  it("returns 502 when Tempo search returns 5xx", async () => {
    tempo.setHandler(() => ({ status: 500, body: { error: "boom" } }));
    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces?service=sample-nginx`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(502);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("tempo_unreachable");
  });

  // ---- Single trace ----

  it("returns 400 for non-hex trace ids", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces/notahextrace`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(400);
  });

  it("returns 200 and the trace tree from Tempo", async () => {
    tempo.setHandler(() => ({
      status: 200,
      body: {
        batches: [
          {
            resource: {
              attributes: [{ key: "service.name", value: { stringValue: "sample-nginx" } }],
            },
            scopeSpans: [
              {
                spans: [
                  {
                    spanId: "s1",
                    name: "GET /",
                    startTimeUnixNano: "1714345200000000000",
                    endTimeUnixNano: "1714345200012000000",
                    status: { code: 1 },
                  },
                ],
              },
            ],
          },
        ],
      },
    }));

    const res = await fetch(`${gatewayUrl}/api/v1/observability/traces/abc123`, {
      headers: { cookie: "lw-sid=sess_obs_ok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { trace_id: string; spans: { span_id: string }[] };
    expect(body.trace_id).toBe("abc123");
    expect(body.spans).toHaveLength(1);
    expect(body.spans[0]?.span_id).toBe("s1");
  });

  // ---- Metrics ----

  describe("GET /api/v1/observability/metrics", () => {
    function okPromBody(): unknown {
      return {
        status: "success",
        data: {
          resultType: "matrix",
          result: [
            {
              metric: {},
              values: [
                [1714345200, "1.5"],
                [1714345215, "2.0"],
              ],
            },
          ],
        },
      };
    }

    it("returns 401 without a session", async () => {
      const res = await fetch(
        `${gatewayUrl}/api/v1/observability/metrics?service=foo&panel=req_rate`,
      );
      expect(res.status).toBe(401);
    });

    it("returns 400 when service param is missing", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/observability/metrics?panel=req_rate`, {
        headers: { cookie: "lw-sid=sess_obs_ok" },
      });
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("bad_request");
    });

    it("returns 400 when panel is not one of the allowed values", async () => {
      argo.setHandler(() => ({
        status: 200,
        body: { spec: { destination: { namespace: "sample-nginx" } } },
      }));
      const res = await fetch(
        `${gatewayUrl}/api/v1/observability/metrics?service=sample-nginx&panel=bogus`,
        { headers: { cookie: "lw-sid=sess_obs_ok" } },
      );
      expect(res.status).toBe(400);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("bad_request");
    });

    it("returns 404 when Argo CD App does not exist", async () => {
      argo.setHandler(() => ({ status: 404, body: {} }));
      const res = await fetch(
        `${gatewayUrl}/api/v1/observability/metrics?service=ghost&panel=req_rate`,
        { headers: { cookie: "lw-sid=sess_obs_ok" } },
      );
      expect(res.status).toBe(404);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("not_found");
    });

    for (const panel of ["req_rate", "error_rate", "p95_latency"] as const) {
      it(`returns 200 and queries Prom with namespace from Argo CD (${panel})`, async () => {
        argo.setHandler(() => ({
          status: 200,
          body: { spec: { destination: { namespace: "sample-nginx" } } },
        }));
        prom.setHandler(() => ({ status: 200, body: okPromBody() }));

        const before = prom.capturedUrls.length;
        const res = await fetch(
          `${gatewayUrl}/api/v1/observability/metrics?service=sample-nginx&panel=${panel}`,
          { headers: { cookie: "lw-sid=sess_obs_ok" } },
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as {
          panel: string;
          unit: string;
          points: { ts: string; value: number }[];
        };
        expect(body.panel).toBe(panel);
        expect(Array.isArray(body.points)).toBe(true);
        expect(body.points).toHaveLength(2);

        const promUrl = prom.capturedUrls[before];
        expect(promUrl).toBeDefined();
        const decoded = decodeURIComponent((promUrl ?? "").replace(/\+/g, " "));
        expect(decoded).toContain('namespace="sample-nginx"');
      });
    }

    it("returns 502 when Prom returns 5xx", async () => {
      argo.setHandler(() => ({
        status: 200,
        body: { spec: { destination: { namespace: "sample-nginx" } } },
      }));
      prom.setHandler(() => ({ status: 500, body: { error: "boom" } }));
      const res = await fetch(
        `${gatewayUrl}/api/v1/observability/metrics?service=sample-nginx&panel=req_rate`,
        { headers: { cookie: "lw-sid=sess_obs_ok" } },
      );
      expect(res.status).toBe(502);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("prom_unreachable");
    });
  });
});
