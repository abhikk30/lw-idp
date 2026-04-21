import type { ConnectRouter } from "@connectrpc/connect";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { IdentityService } from "@lw-idp/contracts/identity/v1";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import type { IdentityServiceDeps } from "./identity.js";
import { makeIdentityServiceImpl } from "./identity.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export async function registerConnectRpc(
  fastify: FastifyArg,
  deps: IdentityServiceDeps,
): Promise<void> {
  const impl = makeIdentityServiceImpl(deps);
  await fastify.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(IdentityService, impl);
    },
  });
}
