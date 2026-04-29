import { createLokiClient, createTempoClient } from "@lw-idp/service-kit";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";

export interface ObservabilityPluginOptions {
  lokiUrl: string;
  tempoUrl: string;
  /**
   * Argo CD API base URL. The plugin reads `.spec.destination.namespace` from
   * the Argo CD Application CR named after the service slug to determine the
   * target namespace for Loki queries — `targetNamespace` is NOT stored in the
   * catalog row, so the App CR is the source of truth.
   */
  argocdApiUrl: string;
}

const obsPluginFn: FastifyPluginAsync<ObservabilityPluginOptions> = async (fastify, opts) => {
  const loki = createLokiClient({ baseUrl: opts.lokiUrl });
  const tempo = createTempoClient({ baseUrl: opts.tempoUrl });
  const argoBase = opts.argocdApiUrl.replace(/\/+$/, "");

  // Resolve a service slug → its targetNamespace by reading the Argo CD
  // Application CR. Returns null if the App doesn't exist (i.e. the service
  // hasn't been registered with Argo CD yet — UI shows a friendly empty state).
  async function resolveNamespace(slug: string, idToken: string): Promise<string | null> {
    const url = `${argoBase}/api/v1/applications/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`argocd app lookup failed: ${res.status}`);
    }
    const json = (await res.json()) as { spec?: { destination?: { namespace?: string } } };
    return json.spec?.destination?.namespace ?? null;
  }

  fastify.get("/api/v1/observability/logs", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    const q = req.query as Record<string, string | undefined>;
    const slug = q.service;
    if (!slug) {
      return reply.code(400).send({ code: "bad_request", message: "service required" });
    }

    let ns: string | null;
    try {
      ns = await resolveNamespace(slug, req.session.idToken ?? "");
    } catch (err) {
      fastify.log.error({ err }, "argocd app lookup failed");
      return reply.code(502).send({ code: "argocd_unreachable", message: "argocd unreachable" });
    }
    if (ns === null) {
      return reply.code(404).send({ code: "not_found", message: "service not found in argocd" });
    }

    const sinceMs = parseSinceMs(q.since ?? "1h");
    const limit = Math.min(Number(q.limit ?? 200) || 200, 1000);
    const traceFilter =
      q.trace_id && /^[0-9a-f]+$/i.test(q.trace_id) ? ` | trace_id="${q.trace_id}"` : "";
    const query = `{namespace="${ns}"} | json${traceFilter}`;
    const now = Date.now();
    const startNs = BigInt(now - sinceMs) * 1_000_000n;
    const endNs = BigInt(now) * 1_000_000n;

    try {
      const r = await loki.queryRange({ query, startNs, endNs, limit, direction: "backward" });
      return reply.send({ lines: r.lines, truncated: r.lines.length >= limit });
    } catch (err) {
      fastify.log.error({ err }, "loki query failed");
      return reply
        .code(502)
        .send({ code: "loki_unreachable", message: "logs backend unreachable" });
    }
  });

  fastify.get("/api/v1/observability/traces", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    const q = req.query as Record<string, string | undefined>;
    const slug = q.service;
    if (!slug) {
      return reply.code(400).send({ code: "bad_request", message: "service required" });
    }
    // Tempo searches by service.name OTel resource attribute, which matches
    // the catalog slug — no Argo CD lookup needed for traces.
    const sinceMs = parseSinceMs(q.since ?? "1h");
    const limit = Math.min(Number(q.limit ?? 10) || 10, 100);
    try {
      const traces = await tempo.searchTraces({ serviceName: slug, sinceMs, limit });
      return reply.send({ traces });
    } catch (err) {
      fastify.log.error({ err }, "tempo search failed");
      return reply
        .code(502)
        .send({ code: "tempo_unreachable", message: "traces backend unreachable" });
    }
  });

  fastify.get<{ Params: { traceId: string } }>(
    "/api/v1/observability/traces/:traceId",
    async (req, reply) => {
      if (!req.session) {
        return reply.code(401).send({ code: "unauthorized", message: "auth required" });
      }
      const traceId = req.params.traceId;
      if (!traceId || !/^[0-9a-f]+$/i.test(traceId)) {
        return reply.code(400).send({ code: "bad_request", message: "invalid trace_id" });
      }
      try {
        const t = await tempo.getTrace(traceId);
        if (t === null) {
          return reply.code(404).send({ code: "not_found", message: "trace not found" });
        }
        return reply.send(t);
      } catch (err) {
        fastify.log.error({ err }, "tempo get-trace failed");
        return reply
          .code(502)
          .send({ code: "tempo_unreachable", message: "traces backend unreachable" });
      }
    },
  );
};

function parseSinceMs(since: string): number {
  const m = /^(\d+)(ms|s|m|h)$/.exec(since);
  if (!m) {
    return 60 * 60 * 1000;
  }
  const n = Number(m[1]);
  switch (m[2]) {
    case "ms":
      return n;
    case "s":
      return n * 1000;
    case "m":
      return n * 60 * 1000;
    case "h":
      return Math.min(n * 60 * 60 * 1000, 24 * 60 * 60 * 1000);
    default:
      return 60 * 60 * 1000;
  }
}

export const observabilityPlugin = fp(obsPluginFn, {
  name: "lw-idp-observability",
  dependencies: ["lw-idp-session"],
});
