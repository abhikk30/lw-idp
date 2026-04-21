import type { ConnectRouter } from "@connectrpc/connect";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { ClusterService } from "@lw-idp/contracts/cluster/v1";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import type { ClusterServiceDeps } from "./cluster.js";
import { makeClusterServiceImpl } from "./cluster.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export async function registerConnectRpc(
  fastify: FastifyArg,
  deps: ClusterServiceDeps,
): Promise<void> {
  const impl = makeClusterServiceImpl(deps);
  await fastify.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(ClusterService, impl);
    },
  });
}
