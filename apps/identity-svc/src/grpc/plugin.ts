// Integration path: @connectrpc/connect-fastify@2.1.1 (peer: fastify ^4.22.1 || ^5.1.0, connect 2.1.1)
// Using fastifyConnectPlugin directly — no middie fallback needed.
import type { ConnectRouter } from "@connectrpc/connect";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { IdentityService } from "@lw-idp/contracts/identity/v1";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import { identityServiceImpl } from "./identity.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export async function registerConnectRpc(fastify: FastifyArg): Promise<void> {
  await fastify.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(IdentityService, identityServiceImpl);
    },
  });
}
