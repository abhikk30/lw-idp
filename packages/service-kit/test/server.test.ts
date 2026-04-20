import { afterEach, describe, expect, it } from "vitest";
import { type LwIdpServer, buildServer } from "../src/index.js";

describe("buildServer", () => {
  let server: LwIdpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("responds 200 on /healthz", async () => {
    server = await buildServer({ name: "svc-test", port: 0 });
    const res = await server.fastify.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "svc-test" });
  });

  it("responds 200 on /readyz by default", async () => {
    server = await buildServer({ name: "svc-test", port: 0 });
    const res = await server.fastify.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(200);
  });

  it("returns 503 on /readyz when a probe reports not ready", async () => {
    server = await buildServer({
      name: "svc-test",
      port: 0,
      readyProbes: [async () => ({ ok: false, name: "db", reason: "no connection" })],
    });
    const res = await server.fastify.inject({ method: "GET", url: "/readyz" });
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({ status: "not_ready", probes: [{ name: "db", ok: false }] });
  });

  it("exposes Prometheus metrics on /metrics", async () => {
    server = await buildServer({ name: "svc-test", port: 0 });
    await server.fastify.inject({ method: "GET", url: "/healthz" });
    const res = await server.fastify.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("process_cpu_user_seconds_total");
    expect(res.body).toContain("nodejs_heap_size_total_bytes");
  });
});
