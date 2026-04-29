import "server-only";

import type {
  ArgoApplication,
  ArgoApplicationCreateSpec,
  ArgoCdAdapter,
  ArgoSyncOptions,
} from "@lw-idp/contracts";
import { headers } from "next/headers";

/**
 * Server-side Argo CD adapter for use in RSC, Route Handlers, Server Actions.
 *
 * Differs from the client-side `createArgoCdAdapter()` in two ways:
 *  - Uses absolute URL pointing at the gateway's internal DNS (no relative
 *    `/api/v1/...` because there's no browser origin in RSC context).
 *  - Forwards the inbound request's `cookie` header explicitly via
 *    `next/headers`, so the gateway sees the authenticated session.
 *
 * Mirrors the pattern used by `lib/api/server.ts::createServerClient()` for
 * the typed catalog/cluster routes.
 */

interface UpstreamArgoApp {
  metadata: { name: string };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string; message?: string };
    operationState?: { phase?: string; finishedAt?: string };
  };
}

interface UpstreamArgoAppList {
  items?: UpstreamArgoApp[];
}

const INTERNAL_BASE_URL = (
  process.env.GATEWAY_INTERNAL_URL?.replace(/\/api\/v1$/, "") ??
  "http://gateway-svc.lw-idp.svc.cluster.local"
).replace(/\/+$/, "");

const KNOWN_SYNC = new Set(["Synced", "OutOfSync", "Unknown"]);
const KNOWN_HEALTH = new Set(["Healthy", "Progressing", "Degraded", "Suspended", "Missing"]);
const KNOWN_OP = new Set(["Running", "Succeeded", "Failed", "Error", ""]);

function mapApplication(upstream: UpstreamArgoApp): ArgoApplication {
  const status = upstream.status ?? {};
  const sync = status.sync ?? {};
  const health = status.health ?? {};
  const opState = status.operationState;
  const syncStatus = sync.status && KNOWN_SYNC.has(sync.status) ? sync.status : "Unknown";
  const healthStatus = health.status && KNOWN_HEALTH.has(health.status) ? health.status : "Healthy";
  const phase = opState?.phase;
  const operationPhase =
    phase !== undefined && KNOWN_OP.has(phase)
      ? (phase as ArgoApplication["operationPhase"])
      : undefined;
  const app: ArgoApplication = {
    name: upstream.metadata.name,
    sync: {
      status: syncStatus as ArgoApplication["sync"]["status"],
      revision: sync.revision ?? "",
    },
    health: {
      status: healthStatus as ArgoApplication["health"]["status"],
      message: health.message ?? "",
    },
    replicas: { ready: 0, desired: 0 },
  };
  if (opState?.finishedAt !== undefined) {
    app.lastSyncAt = opState.finishedAt;
  }
  if (operationPhase !== undefined) {
    app.operationPhase = operationPhase;
  }
  return app;
}

export async function createServerArgoCdAdapter(): Promise<ArgoCdAdapter> {
  const reqHeaders = await headers();
  const cookie = reqHeaders.get("cookie") ?? "";
  const baseHeaders: HeadersInit = cookie
    ? { cookie, accept: "application/json" }
    : { accept: "application/json" };

  async function getJson<T>(path: string): Promise<T> {
    const res = await fetch(`${INTERNAL_BASE_URL}${path}`, {
      headers: baseHeaders,
      cache: "no-store",
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(
        new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
        { status: res.status, body },
      );
    }
    return res.json() as Promise<T>;
  }

  return {
    async listApplications(): Promise<ArgoApplication[]> {
      const data = await getJson<UpstreamArgoAppList>("/api/v1/argocd/applications");
      return (data.items ?? []).map(mapApplication);
    },
    async getApplication(name: string): Promise<ArgoApplication> {
      const data = await getJson<UpstreamArgoApp>(
        `/api/v1/argocd/applications/${encodeURIComponent(name)}`,
      );
      return mapApplication(data);
    },
    async sync(name: string, opts?: ArgoSyncOptions): Promise<void> {
      const res = await fetch(
        `${INTERNAL_BASE_URL}/api/v1/argocd/applications/${encodeURIComponent(name)}/sync`,
        {
          method: "POST",
          headers: { ...baseHeaders, "content-type": "application/json" },
          body: JSON.stringify({
            prune: opts?.prune ?? false,
            force: opts?.force ?? false,
          }),
        },
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
          { status: res.status, body },
        );
      }
    },
    async createApplication(spec: ArgoApplicationCreateSpec): Promise<void> {
      const res = await fetch(`${INTERNAL_BASE_URL}/api/v1/argocd/applications`, {
        method: "POST",
        headers: { ...baseHeaders, "content-type": "application/json" },
        body: JSON.stringify({
          metadata: {
            name: spec.name,
            namespace: "argocd",
            labels: { "app.kubernetes.io/part-of": "lw-idp" },
          },
          spec: {
            project: "default",
            source: {
              repoURL: spec.repoUrl,
              targetRevision: spec.targetRevision,
              path: spec.path,
              helm: { valueFiles: ["values.yaml"] },
            },
            destination: {
              server: "https://kubernetes.default.svc",
              namespace: spec.destinationNamespace,
            },
            syncPolicy: {
              automated: { prune: false, selfHeal: true },
              syncOptions: ["CreateNamespace=true", "ApplyOutOfSyncOnly=true"],
            },
          },
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw Object.assign(
          new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
          { status: res.status, body },
        );
      }
    },
  };
}
