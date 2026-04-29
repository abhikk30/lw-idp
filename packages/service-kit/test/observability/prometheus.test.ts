import { type Server, createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PromError, createPromClient } from "../../src/index.js";

type PromHandler = (req: { url: string }) => { status: number; body: unknown };

async function startPromStub(handler: PromHandler): Promise<{ server: Server; baseUrl: string }> {
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

describe("createPromClient.queryRange", () => {
  let server: Server | undefined;
  let baseUrl = "";

  afterEach(async () => {
    const s = server;
    if (s) {
      await new Promise<void>((r) => s.close(() => r()));
      server = undefined;
    }
  });

  async function startWith(handler: PromHandler): Promise<void> {
    const started = await startPromStub(handler);
    server = started.server;
    baseUrl = started.baseUrl;
  }

  it("returns parsed points for a happy-path single-series response", async () => {
    let capturedUrl = "";
    await startWith(({ url }) => {
      capturedUrl = url;
      return {
        status: 200,
        body: {
          status: "success",
          data: {
            resultType: "matrix",
            result: [
              {
                metric: { __name__: "http_requests_total", job: "gateway-svc" },
                values: [
                  [1777445776, "23.4"],
                  [1777445791, "24.1"],
                ],
              },
            ],
          },
        },
      };
    });

    const client = createPromClient({ baseUrl });
    const { points } = await client.queryRange({
      query: "sum(rate(http_requests_total[1m]))",
      startMs: 1777445776000,
      endMs: 1777445836000,
      stepSec: 15,
    });

    expect(capturedUrl).toContain("/api/v1/query_range");
    expect(capturedUrl).toContain("query=");
    expect(decodeURIComponent(capturedUrl)).toContain("sum(rate(http_requests_total[1m]))");
    expect(capturedUrl).toContain("start=1777445776");
    expect(capturedUrl).toContain("end=1777445836");
    expect(capturedUrl).toContain("step=15s");

    expect(points).toHaveLength(2);
    expect(points[0]).toMatchObject({
      ts: new Date(1777445776000).toISOString(),
      value: 23.4,
    });
    expect(points[1]).toMatchObject({
      ts: new Date(1777445791000).toISOString(),
      value: 24.1,
    });
  });

  it("returns empty points (not an error) when result array is empty", async () => {
    await startWith(() => ({
      status: 200,
      body: {
        status: "success",
        data: { resultType: "matrix", result: [] },
      },
    }));

    const client = createPromClient({ baseUrl });
    const { points } = await client.queryRange({
      query: "sum(rate(http_requests_total[1m]))",
      startMs: 1_000_000,
      endMs: 2_000_000,
      stepSec: 15,
    });

    expect(points).toEqual([]);
  });

  it("throws PromError with status code on 5xx upstream", async () => {
    await startWith(() => ({ status: 503, body: { error: "prom overloaded" } }));

    const client = createPromClient({ baseUrl });
    await expect(
      client.queryRange({
        query: "up",
        startMs: 1_000_000,
        endMs: 2_000_000,
        stepSec: 15,
      }),
    ).rejects.toMatchObject({ status: 503 });
    await expect(
      client.queryRange({
        query: "up",
        startMs: 1_000_000,
        endMs: 2_000_000,
        stepSec: 15,
      }),
    ).rejects.toBeInstanceOf(PromError);
  });
});
