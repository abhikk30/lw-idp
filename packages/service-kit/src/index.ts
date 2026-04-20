export * from "./server.js";
export * from "./shutdown.js";

import { type BuildServerOptions, type LwIdpServer, buildServer } from "./server.js";
import { wireGracefulShutdown } from "./shutdown.js";

export async function startServer(opts: BuildServerOptions): Promise<LwIdpServer> {
  const server = await buildServer(opts);
  wireGracefulShutdown(server);
  await server.listen();
  return server;
}
