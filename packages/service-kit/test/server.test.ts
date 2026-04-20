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

  it("invokes the register callback and allows custom routes", async () => {
    server = await buildServer({
      name: "svc-test",
      port: 0,
      register: async (fastify) => {
        fastify.get("/custom", async () => ({ hello: "world" }));
      },
    });
    const res = await server.fastify.inject({ method: "GET", url: "/custom" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ hello: "world" });
  });

  it("register callback can register routes and the built-in /healthz still works", async () => {
    server = await buildServer({
      name: "svc-test",
      port: 0,
      register: async (fastify) => {
        fastify.post("/echo", async (req) => req.body);
      },
    });
    const healthz = await server.fastify.inject({ method: "GET", url: "/healthz" });
    expect(healthz.statusCode).toBe(200);
    const echo = await server.fastify.inject({
      method: "POST",
      url: "/echo",
      headers: { "content-type": "application/json" },
      payload: { a: 1 },
    });
    expect(echo.statusCode).toBe(200);
    expect(echo.json()).toEqual({ a: 1 });
  });
});
