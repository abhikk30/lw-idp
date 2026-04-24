import { afterEach, describe, expect, it } from "vitest";
import { type LwIdpServer, buildServer, runShutdown } from "../src/index.js";

describe("runShutdown", () => {
  let server: LwIdpServer | undefined;
  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("invokes onShutdown before closing the server", async () => {
    const order: string[] = [];
    server = await buildServer({ name: "t", port: 0 });
    const origClose = server.close.bind(server);
    server.close = async () => {
      order.push("close");
      await origClose();
    };

    await runShutdown(server, {
      onShutdown: async () => {
        order.push("onShutdown");
      },
    });

    expect(order).toEqual(["onShutdown", "close"]);
  });

  it("propagates onShutdown errors and still throws", async () => {
    server = await buildServer({ name: "t", port: 0 });
    await expect(
      runShutdown(server, {
        onShutdown: async () => {
          throw new Error("boom");
        },
      }),
    ).rejects.toThrow("boom");
  });

  it("no-ops if onShutdown is absent", async () => {
    server = await buildServer({ name: "t", port: 0 });
    await expect(runShutdown(server, {})).resolves.toBeUndefined();
  });
});
