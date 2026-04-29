import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { TempoError, createTempoClient } from "../../src/index.js";

type TempoHandler = (req: { url: string }) => { status: number; body: unknown };

async function startTempoStub(handler: TempoHandler): Promise<{ server: Server; baseUrl: string }> {
  const server = createServer((req, res) => {
    const result = handler({ url: req.url ?? "" });
    res.statusCode = result.status;
    res.setHeader("content-type", "application/json");
    res.end(typeof result.body === "string" ? result.body : JSON.stringify(result.body));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  const port = (server.address() as AddressInfo).port;
  return { server, baseUrl: `http://127.0.0.1:${port}` };
}

describe("createTempoClient", () => {
  let server: Server | undefined;
  let baseUrl = "";

  afterEach(async () => {
    const s = server;
    if (s) {
      await new Promise<void>((r) => s.close(() => r()));
      server = undefined;
    }
  });

  async function startWith(handler: TempoHandler): Promise<void> {
    const started = await startTempoStub(handler);
    server = started.server;
    baseUrl = started.baseUrl;
  }

  describe("searchTraces", () => {
    it("returns parsed TraceSummary[] for a happy-path response", async () => {
      let capturedUrl = "";
      await startWith(({ url }) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            traces: [
              {
                traceID: "1a2b3c",
                rootServiceName: "gateway-svc",
                rootTraceName: "GET /api/v1/services",
                startTimeUnixNano: "1777445776123000000",
                durationMs: 47,
                spanSet: {
                  spans: [{ status: "STATUS_CODE_OK" }, { status: "STATUS_CODE_OK" }],
                },
              },
              {
                traceID: "deadbeef",
                rootServiceName: "identity-svc",
                rootTraceName: "POST /login",
                startTimeUnixNano: "1777445780000000000",
                durationMs: 120,
                spanSet: {
                  spans: [{ status: "STATUS_CODE_OK" }, { status: "STATUS_CODE_ERROR" }],
                },
              },
            ],
          },
        };
      });

      const client = createTempoClient({ baseUrl });
      const traces = await client.searchTraces({
        serviceName: "gateway-svc",
        sinceMs: 60_000,
        limit: 25,
      });

      expect(capturedUrl).toContain("/api/search");
      expect(capturedUrl).toContain("limit=25");
      expect(capturedUrl).toContain("start=");
      expect(capturedUrl).toContain("end=");

      expect(traces).toHaveLength(2);
      expect(traces[0]).toMatchObject({
        trace_id: "1a2b3c",
        root_service: "gateway-svc",
        root_operation: "GET /api/v1/services",
        started_at: new Date(1777445776123).toISOString(),
        duration_ms: 47,
        span_count: 2,
        status: "ok",
      });
      expect(traces[1]).toMatchObject({
        trace_id: "deadbeef",
        root_service: "identity-svc",
        span_count: 2,
        status: "error",
      });
    });

    it("includes resource.service.name TraceQL filter in the query", async () => {
      let capturedUrl = "";
      await startWith(({ url }) => {
        capturedUrl = url;
        return { status: 200, body: { traces: [] } };
      });

      const client = createTempoClient({ baseUrl });
      await client.searchTraces({
        serviceName: "gateway-svc",
        sinceMs: 60_000,
        limit: 10,
      });

      const decoded = decodeURIComponent(capturedUrl);
      expect(decoded).toContain('resource.service.name="gateway-svc"');
    });

    it("throws TempoError with status code on 5xx upstream", async () => {
      await startWith(() => ({ status: 503, body: { error: "tempo overloaded" } }));

      const client = createTempoClient({ baseUrl });
      await expect(
        client.searchTraces({ serviceName: "gateway-svc", sinceMs: 60_000, limit: 10 }),
      ).rejects.toMatchObject({ name: "TempoError", status: 503 });
      await expect(
        client.searchTraces({ serviceName: "gateway-svc", sinceMs: 60_000, limit: 10 }),
      ).rejects.toBeInstanceOf(TempoError);
    });
  });

  describe("getTrace", () => {
    it("returns spans sorted by started_at with parent_id populated", async () => {
      let capturedUrl = "";
      await startWith(({ url }) => {
        capturedUrl = url;
        return {
          status: 200,
          body: {
            batches: [
              {
                resource: {
                  attributes: [{ key: "service.name", value: { stringValue: "gateway-svc" } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      // child span first to verify sorting
                      {
                        spanId: "child1",
                        parentSpanId: "root1",
                        name: "db.query",
                        startTimeUnixNano: "1777445776150000000",
                        endTimeUnixNano: "1777445776160000000",
                        status: { code: 1 },
                        attributes: [
                          { key: "db.system", value: { stringValue: "postgres" } },
                          { key: "db.rows", value: { intValue: 42 } },
                          { key: "db.cached", value: { boolValue: true } },
                        ],
                      },
                      {
                        spanId: "root1",
                        parentSpanId: "",
                        name: "GET /api/v1/services",
                        startTimeUnixNano: "1777445776123000000",
                        endTimeUnixNano: "1777445776170000000",
                        status: { code: 1 },
                        attributes: [{ key: "http.method", value: { stringValue: "GET" } }],
                      },
                    ],
                  },
                ],
              },
              {
                resource: {
                  attributes: [{ key: "service.name", value: { stringValue: "identity-svc" } }],
                },
                scopeSpans: [
                  {
                    spans: [
                      {
                        spanId: "child2",
                        parentSpanId: "child1",
                        name: "auth.check",
                        startTimeUnixNano: "1777445776155000000",
                        endTimeUnixNano: "1777445776158000000",
                        status: { code: 2 },
                        attributes: [],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        };
      });

      const client = createTempoClient({ baseUrl });
      const result = await client.getTrace("abc123");

      expect(capturedUrl).toContain("/api/traces/abc123");
      expect(result).not.toBeNull();
      expect(result?.trace_id).toBe("abc123");
      expect(result?.spans).toHaveLength(3);

      // sorted ascending by started_at
      expect(result?.spans[0]?.span_id).toBe("root1");
      expect(result?.spans[1]?.span_id).toBe("child1");
      expect(result?.spans[2]?.span_id).toBe("child2");

      // root has parent_id null
      expect(result?.spans[0]?.parent_id).toBeNull();
      expect(result?.spans[0]?.service).toBe("gateway-svc");
      expect(result?.spans[0]?.status).toBe("ok");
      expect(result?.spans[0]?.attributes).toEqual({ "http.method": "GET" });

      // child has parent_id populated
      expect(result?.spans[1]?.parent_id).toBe("root1");
      expect(result?.spans[1]?.service).toBe("gateway-svc");
      expect(result?.spans[1]?.attributes).toEqual({
        "db.system": "postgres",
        "db.rows": 42,
        "db.cached": true,
      });

      // cross-batch span uses its own batch's resource service
      expect(result?.spans[2]?.parent_id).toBe("child1");
      expect(result?.spans[2]?.service).toBe("identity-svc");
      expect(result?.spans[2]?.status).toBe("error");
    });

    it("returns null for 404 (trace not found)", async () => {
      await startWith(() => ({ status: 404, body: { error: "trace not found" } }));

      const client = createTempoClient({ baseUrl });
      const result = await client.getTrace("missing");
      expect(result).toBeNull();
    });

    it("throws TempoError with status code on 5xx upstream", async () => {
      await startWith(() => ({ status: 502, body: { error: "bad gateway" } }));

      const client = createTempoClient({ baseUrl });
      await expect(client.getTrace("abc")).rejects.toMatchObject({
        name: "TempoError",
        status: 502,
      });
      await expect(client.getTrace("abc")).rejects.toBeInstanceOf(TempoError);
    });
  });
});
