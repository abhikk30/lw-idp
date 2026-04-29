import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { LokiError, createLokiClient } from "../../src/index.js";

type LokiHandler = (req: { url: string }) => { status: number; body: unknown };

async function startLokiStub(handler: LokiHandler): Promise<{ server: Server; baseUrl: string }> {
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

describe("createLokiClient.queryRange", () => {
  let server: Server | undefined;
  let baseUrl = "";

  afterEach(async () => {
    const s = server;
    if (s) {
      await new Promise<void>((r) => s.close(() => r()));
      server = undefined;
    }
  });

  async function startWith(handler: LokiHandler): Promise<void> {
    const started = await startLokiStub(handler);
    server = started.server;
    baseUrl = started.baseUrl;
  }

  it("returns parsed LokiLine[] for a happy-path response", async () => {
    let capturedUrl = "";
    await startWith(({ url }) => {
      capturedUrl = url;
      return {
        status: 200,
        body: {
          data: {
            result: [
              {
                stream: { namespace: "lw-idp", pod: "gateway-svc-abc" },
                values: [
                  ["1714345200000000000", "kubelet probe ok"],
                  [
                    "1714345201000000000",
                    JSON.stringify({ level: "info", msg: "request handled" }),
                  ],
                ],
              },
            ],
          },
        },
      };
    });

    const client = createLokiClient({ baseUrl });
    const { lines } = await client.queryRange({
      query: '{namespace="lw-idp"}',
      startNs: 1714345200000000000n,
      endNs: 1714345300000000000n,
      limit: 100,
    });

    expect(capturedUrl).toContain("/loki/api/v1/query_range");
    expect(capturedUrl).toContain("query=");
    expect(capturedUrl).toContain("start=1714345200000000000");
    expect(capturedUrl).toContain("end=1714345300000000000");
    expect(capturedUrl).toContain("limit=100");
    expect(capturedUrl).toContain("direction=backward");

    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({
      ts: new Date(1714345200000).toISOString(),
      raw: "kubelet probe ok",
      level: null,
      msg: null,
      trace_id: null,
      span_id: null,
      pod: "gateway-svc-abc",
    });
    expect(lines[1]).toMatchObject({
      ts: new Date(1714345201000).toISOString(),
      level: "info",
      msg: "request handled",
      trace_id: null,
      span_id: null,
      pod: "gateway-svc-abc",
    });
  });

  it("parses trace_id and span_id from JSON log lines (snake_case and camelCase)", async () => {
    await startWith(() => ({
      status: 200,
      body: {
        data: {
          result: [
            {
              stream: { pod: "identity-svc-1" },
              values: [
                [
                  "1714345200000000000",
                  JSON.stringify({
                    level: "info",
                    msg: "snake",
                    trace_id: "trace-snake",
                    span_id: "span-snake",
                  }),
                ],
                [
                  "1714345201000000000",
                  JSON.stringify({
                    level: "info",
                    msg: "camel",
                    traceId: "trace-camel",
                    spanId: "span-camel",
                  }),
                ],
                ["1714345202000000000", JSON.stringify({ level: "info", msg: "no trace" })],
              ],
            },
          ],
        },
      },
    }));

    const client = createLokiClient({ baseUrl });
    const { lines } = await client.queryRange({
      query: '{namespace="lw-idp"}',
      startNs: 1n,
      endNs: 2n,
      limit: 10,
    });

    expect(lines[0]?.trace_id).toBe("trace-snake");
    expect(lines[0]?.span_id).toBe("span-snake");
    expect(lines[1]?.trace_id).toBe("trace-camel");
    expect(lines[1]?.span_id).toBe("span-camel");
    expect(lines[2]?.trace_id).toBeNull();
    expect(lines[2]?.span_id).toBeNull();
  });

  it("throws LokiError with status code on 5xx upstream", async () => {
    await startWith(() => ({ status: 503, body: { error: "loki overloaded" } }));

    const client = createLokiClient({ baseUrl });
    await expect(
      client.queryRange({
        query: '{namespace="lw-idp"}',
        startNs: 1n,
        endNs: 2n,
        limit: 10,
      }),
    ).rejects.toMatchObject({
      name: "LokiError",
      status: 503,
    });

    await expect(
      client.queryRange({
        query: '{namespace="lw-idp"}',
        startNs: 1n,
        endNs: 2n,
        limit: 10,
      }),
    ).rejects.toBeInstanceOf(LokiError);
  });
});
