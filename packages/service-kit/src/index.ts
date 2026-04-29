export * from "./server.js";
export * from "./shutdown.js";
export * from "./env.js";
export * from "./redis.js";
export {
  createLokiClient,
  LokiError,
  type LokiLine,
  type LokiClient,
  type LokiQueryRangeOpts,
} from "./observability/loki.js";
export {
  createTempoClient,
  TempoError,
  type TraceSummary,
  type SpanNode,
  type TempoClient,
} from "./observability/tempo.js";

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
