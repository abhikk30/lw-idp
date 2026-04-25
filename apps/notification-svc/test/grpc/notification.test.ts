import { Code, ConnectError, createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { NotificationService } from "@lw-idp/contracts/notification/v1";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerConnectRpc } from "../../src/grpc/plugin.js";

let server: LwIdpServer;
let baseUrl: string;

beforeAll(async () => {
  server = await buildServer({
    name: "notification-svc-grpc-test",
    port: 0,
    register: async (fastify) => {
      await registerConnectRpc(fastify);
    },
  });
  const addr = await server.listen();
  baseUrl = addr.replace("0.0.0.0", "127.0.0.1");
}, 30_000);

afterAll(async () => {
  await server?.close();
});

describe("NotificationService gRPC (P1.6 stubs)", () => {
  it("ListRecent returns Unimplemented", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(NotificationService, transport);
    await expect(
      client.listRecent({ userId: "u-1", limit: 10, pageToken: "" }),
    ).rejects.toMatchObject({
      code: Code.Unimplemented,
    });
  });

  it("MarkRead returns Unimplemented", async () => {
    const transport = createConnectTransport({ baseUrl, httpVersion: "1.1" });
    const client = createClient(NotificationService, transport);
    try {
      await client.markRead({ notificationId: "n-1", userId: "u-1" });
      throw new Error("expected ConnectError");
    } catch (err) {
      expect(err).toBeInstanceOf(ConnectError);
      expect((err as ConnectError).code).toBe(Code.Unimplemented);
    }
  });
});
