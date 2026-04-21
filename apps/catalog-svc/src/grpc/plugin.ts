import type { ConnectRouter } from "@connectrpc/connect";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { CatalogService } from "@lw-idp/contracts/catalog/v1";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import type { CatalogServiceDeps } from "./catalog.js";
import { makeCatalogServiceImpl } from "./catalog.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export async function registerConnectRpc(
  fastify: FastifyArg,
  deps: CatalogServiceDeps,
): Promise<void> {
  const impl = makeCatalogServiceImpl(deps);
  await fastify.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(CatalogService, impl);
    },
  });
}
