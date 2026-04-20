import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterEach, describe, expect, it } from "vitest";

describe("identity-svc", () => {
  let server: LwIdpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("boots with name 'identity-svc' and serves /healthz", async () => {
    server = await buildServer({ name: "identity-svc", port: 0 });
    const res = await server.fastify.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", service: "identity-svc" });
  });
});
