import type { LwIdpServer } from "./server.js";

export interface ShutdownOptions {
  onShutdown?: () => Promise<void>;
  timeoutMs?: number;
}

export async function runShutdown(server: LwIdpServer, opts: ShutdownOptions = {}): Promise<void> {
  if (opts.onShutdown) {
    await opts.onShutdown();
  }
  await server.close();
}

export function wireGracefulShutdown(server: LwIdpServer, opts: ShutdownOptions = {}): void {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const signals: NodeJS.Signals[] = ["SIGTERM", "SIGINT"];
  let shuttingDown = false;
  for (const sig of signals) {
    process.once(sig, async () => {
      if (shuttingDown) {
        return;
      }
      shuttingDown = true;
      server.fastify.log.info({ signal: sig }, "graceful shutdown");
      const timer = setTimeout(() => {
        server.fastify.log.error({ signal: sig, timeoutMs }, "shutdown timed out — force exit");
        process.exit(1);
      }, timeoutMs);
      timer.unref();
      try {
        await runShutdown(server, opts);
        process.exit(0);
      } catch (err) {
        server.fastify.log.error({ err }, "error during shutdown");
        process.exit(1);
      }
    });
  }
}
