import { createLokiClient, createPromClient, createTempoClient } from "@lw-idp/service-kit";
import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { K8sClient } from "../clients/k8s.js";

export interface ObservabilityPluginOptions {
  lokiUrl: string;
  tempoUrl: string;
  promUrl: string;
  /**
   * Argo CD API base URL. The plugin reads `.spec.destination.namespace` from
   * the Argo CD Application CR named after the service slug to determine the
   * target namespace for Loki queries — `targetNamespace` is NOT stored in the
   * catalog row, so the App CR is the source of truth.
   */
  argocdApiUrl: string;
  /**
   * In-cluster Kubernetes API client. Used by /api/v1/observability/pods to
   * list pods in the resolved targetNamespace (filtered by
   * `app.kubernetes.io/instance=<slug>` to scope to the service's pods).
   */
  k8sClient: K8sClient;
}

// PromQL filters by `service=<slug>` rather than namespace because the
// lw-idp namespace hosts 5 services; namespace-only would mash them
// together. The metric series name is `http_request_duration_seconds_*`
// (lw-idp services emit Prometheus-style series via prom-client) — the
// OTel-style `http_server_duration_seconds_*` name doesn't exist here.
// p95 multiplies by 1000 to return ms (the histogram is in seconds).
const PROMQL: Record<string, (svc: string) => string> = {
  req_rate: (svc) => `sum(rate(http_request_duration_seconds_count{service="${svc}"}[1m]))`,
  error_rate: (svc) =>
    `sum(rate(http_request_duration_seconds_count{service="${svc}",status_code=~"5.."}[1m])) / clamp_min(sum(rate(http_request_duration_seconds_count{service="${svc}"}[1m])), 1e-9)`,
  p95_latency: (svc) =>
    `1000 * histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket{service="${svc}"}[1m])) by (le))`,
};

const obsPluginFn: FastifyPluginAsync<ObservabilityPluginOptions> = async (fastify, opts) => {
  const loki = createLokiClient({ baseUrl: opts.lokiUrl });
  const tempo = createTempoClient({ baseUrl: opts.tempoUrl });
  const prom = createPromClient({ baseUrl: opts.promUrl });
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

  fastify.get("/api/v1/observability/metrics", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    const q = req.query as Record<string, string | undefined>;
    const slug = q.service;
    if (!slug) {
      return reply.code(400).send({ code: "bad_request", message: "service required" });
    }
    const panel = q.panel ?? "";
    if (!(panel in PROMQL)) {
      return reply
        .code(400)
        .send({ code: "bad_request", message: "panel must be req_rate|error_rate|p95_latency" });
    }

    // Metrics filter by `service=<slug>` directly (the prom-client series'
    // `service` label matches the catalog slug 1:1). No Argo CD lookup
    // needed — and that lookup would be wrong anyway for IDP services
    // themselves, which don't have an Argo CD App in this cluster.
    const sinceMs = parseSinceMs(q.since ?? "1h");
    const stepRaw = q.step ?? "15s";
    const stepSec = Math.max(1, Number(stepRaw.replace(/s$/, "")));
    const now = Date.now();

    try {
      const result = await prom.queryRange({
        query: PROMQL[panel](slug),
        startMs: now - sinceMs,
        endMs: now,
        stepSec,
      });
      const unit = panel === "req_rate" ? "req/s" : panel === "error_rate" ? "ratio" : "ms";
      return reply.send({ panel, unit, points: result.points });
    } catch (err) {
      fastify.log.error({ err }, "prom query failed");
      return reply
        .code(502)
        .send({ code: "prom_unreachable", message: "metrics backend unreachable" });
    }
  });

  fastify.get("/api/v1/observability/pods", async (req, reply) => {
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

    try {
      const pods = await opts.k8sClient.listPods(ns, `app.kubernetes.io/instance=${slug}`);
      return reply.send({ pods });
    } catch (err) {
      fastify.log.error({ err }, "k8s list pods failed");
      return reply.code(502).send({ code: "k8s_unreachable", message: "kube api unreachable" });
    }
  });
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
