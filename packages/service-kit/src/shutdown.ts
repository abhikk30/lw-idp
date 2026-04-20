import type { LwIdpServer } from "./server.js";

export function wireGracefulShutdown(server: LwIdpServer, timeoutMs = 10_000): void {
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
        await server.close();
        process.exit(0);
      } catch (err) {
        server.fastify.log.error({ err }, "error during close");
        process.exit(1);
      }
    });
  }
}
