export * from "./server.js";
export * from "./shutdown.js";
export * from "./env.js";

import { type BuildServerOptions, type LwIdpServer, buildServer } from "./server.js";
import { wireGracefulShutdown } from "./shutdown.js";

export async function startServer(
  opts: BuildServerOptions & { shutdownTimeoutMs?: number },
): Promise<LwIdpServer> {
  const server = await buildServer(opts);
  wireGracefulShutdown(server, {
    ...(opts.onShutdown !== undefined ? { onShutdown: opts.onShutdown } : {}),
    timeoutMs: opts.shutdownTimeoutMs ?? 15_000,
  });
  await server.listen();
  return server;
}
