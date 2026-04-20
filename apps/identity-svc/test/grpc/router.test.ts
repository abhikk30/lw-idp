import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { IdentityService } from "@lw-idp/contracts/identity/v1";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";

describe("identity-svc ConnectRPC wiring", () => {
  let server: LwIdpServer;
  let baseUrl: string;

  beforeAll(async () => {
    server = await buildServer({
      name: "identity-svc",
      port: 0,
      register: async (fastify) => {
        await registerConnectRpc(fastify);
      },
    });
    baseUrl = await server.listen();
  }, 30_000);

  afterAll(async () => {
    await server?.close();
  });

  it("responds to ListUsers with an empty list via Connect protocol", async () => {
    const transport = createConnectTransport({
      baseUrl,
      httpVersion: "1.1",
    });
    const client = createClient(IdentityService, transport);
    const res = await client.listUsers({ limit: 10, pageToken: "" });
    expect(res.users).toEqual([]);
    expect(res.nextPageToken).toBe("");
  });

  it("returns Unimplemented error for unimplemented methods", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(IdentityService, transport);
    await expect(client.verifyToken({ idToken: "doesntmatter" })).rejects.toThrow(/unimplemented/i);
  });
});
