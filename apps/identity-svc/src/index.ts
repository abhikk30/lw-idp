import { startServer } from "@lw-idp/service-kit";
import { registerConnectRpc } from "./grpc/plugin.js";

const port = Number(process.env.PORT ?? 4001);

await startServer({
  name: "identity-svc",
  port,
  register: async (fastify) => {
    await registerConnectRpc(fastify);
  },
});
