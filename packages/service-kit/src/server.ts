import { createLogger } from "@lw-idp/telemetry";
import Fastify from "fastify";
import type { FastifyBaseLogger, FastifyInstance } from "fastify";
import metricsPlugin, { type IMetricsPluginOptions } from "fastify-metrics";

export interface ReadyProbeResult {
  ok: boolean;
  name: string;
  reason?: string;
}

export type ReadyProbe = () => Promise<ReadyProbeResult>;

export interface BuildServerOptions {
  name: string;
  port: number;
  host?: string;
  version?: string;
  readyProbes?: ReadyProbe[];
  register?: (fastify: FastifyInstance) => Promise<void>;
}

export interface LwIdpServer {
  fastify: FastifyInstance<
    import("http").Server,
    import("http").IncomingMessage,
    import("http").ServerResponse,
    FastifyBaseLogger
  >;
  listen(): Promise<string>;
  close(): Promise<void>;
}

export async function buildServer(opts: BuildServerOptions): Promise<LwIdpServer> {
  const logger = createLogger({ service: opts.name });
  const fastify = Fastify({
    loggerInstance: logger as FastifyBaseLogger,
    disableRequestLogging: false,
    trustProxy: true,
  });

  const metricsOptions: Partial<IMetricsPluginOptions> = {
    endpoint: "/metrics",
    defaultMetrics: { enabled: true },
    routeMetrics: { enabled: true },
    clearRegisterOnInit: true,
  };

  await fastify.register(metricsPlugin.default, metricsOptions);

  fastify.get("/healthz", async () => ({ status: "ok", service: opts.name }));

  fastify.get("/readyz", async (_req, reply) => {
    const probes = opts.readyProbes ?? [];
    const results = await Promise.all(
      probes.map(async (probe) => {
        try {
          return await probe();
        } catch (err) {
          return {
            ok: false,
            name: "unknown",
            reason: err instanceof Error ? err.message : String(err),
          };
        }
      }),
    );
    const notReady = results.filter((r) => !r.ok);
    if (notReady.length > 0) {
      return reply.code(503).send({ status: "not_ready", probes: results });
    }
    return { status: "ready", probes: results };
  });

  if (opts.register) {
    await opts.register(fastify);
  }

  const host = opts.host ?? "0.0.0.0";

  return {
    fastify,
    listen: async () => fastify.listen({ port: opts.port, host }),
    close: async () => {
      await fastify.close();
    },
  };
}
