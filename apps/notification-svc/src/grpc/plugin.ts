import type { ConnectRouter } from "@connectrpc/connect";
import { fastifyConnectPlugin } from "@connectrpc/connect-fastify";
import { NotificationService } from "@lw-idp/contracts/notification/v1";
import type { BuildServerOptions } from "@lw-idp/service-kit";
import type { NotificationServiceDeps } from "./notification.js";
import { makeNotificationServiceImpl } from "./notification.js";

// Extract FastifyInstance type from service-kit's register callback signature
type RegisterFn = NonNullable<BuildServerOptions["register"]>;
type FastifyArg = Parameters<RegisterFn>[0];

export async function registerConnectRpc(
  fastify: FastifyArg,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  const impl = makeNotificationServiceImpl(deps);
  await fastify.register(fastifyConnectPlugin, {
    routes(router: ConnectRouter) {
      router.service(NotificationService, impl);
    },
  });
}
