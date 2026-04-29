import type {
  ArgoApplication,
  ArgoApplicationCreateSpec,
  ArgoCdAdapter,
  ArgoHealthStatus,
  ArgoOperationPhase,
  ArgoReplicaCounts,
  ArgoSyncOptions,
  ArgoSyncStatus,
} from "@lw-idp/contracts";

interface ResourceTreeNode {
  kind?: string;
  health?: { status?: string };
}
interface ResourceTreeResponse {
  nodes?: ResourceTreeNode[];
}

function countPods(tree: ResourceTreeResponse): ArgoReplicaCounts {
  const pods = (tree.nodes ?? []).filter((n) => n.kind === "Pod");
  return {
    desired: pods.length,
    ready: pods.filter((n) => n.health?.status === "Healthy").length,
  };
}

// ---------------------------------------------------------------------------
// Upstream Argo CD response shapes (minimal — only fields we read)
// ---------------------------------------------------------------------------

interface UpstreamArgoApp {
  metadata: {
    name: string;
  };
  status?: {
    sync?: {
      status?: string;
      revision?: string;
    };
    health?: {
      status?: string;
      message?: string;
    };
    operationState?: {
      phase?: string;
      finishedAt?: string;
    };
  };
}

interface UpstreamArgoAppList {
  items?: UpstreamArgoApp[];
}

// ---------------------------------------------------------------------------
// Mapping helpers
// ---------------------------------------------------------------------------

const KNOWN_SYNC_STATUSES = new Set(["Synced", "OutOfSync", "Unknown"]);
const KNOWN_HEALTH_STATUSES = new Set([
  "Healthy",
  "Progressing",
  "Degraded",
  "Suspended",
  "Missing",
]);
const KNOWN_OP_PHASES = new Set(["Running", "Succeeded", "Failed", "Error", ""]);

function toSyncStatus(raw: string | undefined): ArgoSyncStatus {
  if (raw && KNOWN_SYNC_STATUSES.has(raw)) {
    return raw as ArgoSyncStatus;
  }
  return "Unknown";
}

function toHealthStatus(raw: string | undefined): ArgoHealthStatus {
  if (raw && KNOWN_HEALTH_STATUSES.has(raw)) {
    return raw as ArgoHealthStatus;
  }
  return "Healthy";
}

function toOperationPhase(raw: string | undefined): ArgoOperationPhase | undefined {
  if (raw === undefined) {
    return undefined;
  }
  if (KNOWN_OP_PHASES.has(raw)) {
    return raw as ArgoOperationPhase;
  }
  return undefined;
}

function mapApplication(upstream: UpstreamArgoApp): ArgoApplication {
  const status = upstream.status ?? {};
  const opState = status.operationState;

  const app: ArgoApplication = {
    name: upstream.metadata.name,
    sync: {
      status: toSyncStatus(status.sync?.status),
      revision: status.sync?.revision ?? "",
    },
    health: {
      status: toHealthStatus(status.health?.status),
      // Argo CD omits message when Healthy — normalise to empty string.
      message: status.health?.message ?? "",
    },
    // Replica counts are not available in the Application response without a
    // separate /resource-tree call. Both fields default to 0; components should
    // render "—" when both are 0.
    replicas: {
      ready: 0,
      desired: 0,
    },
  };

  // exactOptionalPropertyTypes: set optional fields only when they have a value.
  const lastSyncAt = opState?.finishedAt;
  if (lastSyncAt !== undefined) {
    app.lastSyncAt = lastSyncAt;
  }
  const operationPhase = toOperationPhase(opState?.phase);
  if (operationPhase !== undefined) {
    app.operationPhase = operationPhase;
  }

  return app;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a real ArgoCdAdapter that calls the gateway proxy routes at
 * `/api/v1/argocd/*`. The `lw-sid` cookie is forwarded automatically via
 * `credentials: "same-origin"`.
 *
 * Note: uses plain `fetch` (not openapi-fetch) because the argocd proxy routes
 * are pass-through and carry Argo CD's own JSON shape — they are not part of
 * the typed gateway OpenAPI spec.
 */
export function createArgoCdAdapter(
  /** Override for tests — defaults to `window.fetch`. */
  fetchImpl: typeof fetch = globalThis.fetch,
): ArgoCdAdapter {
  const base = "/api/v1";

  async function get<T>(path: string): Promise<T> {
    const res = await fetchImpl(`${base}${path}`, {
      credentials: "same-origin",
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

  async function post(path: string, payload: unknown): Promise<void> {
    const res = await fetchImpl(`${base}${path}`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw Object.assign(
        new Error((body as { message?: string }).message ?? `HTTP ${res.status}`),
        { status: res.status, body },
      );
    }
  }

  return {
    async listApplications(): Promise<ArgoApplication[]> {
      const data = await get<UpstreamArgoAppList>("/argocd/applications");
      return (data.items ?? []).map(mapApplication);
    },

    async getApplication(name: string): Promise<ArgoApplication> {
      const data = await get<UpstreamArgoApp>(`/argocd/applications/${encodeURIComponent(name)}`);
      return mapApplication(data);
    },

    async getReplicaCounts(name: string): Promise<ArgoReplicaCounts> {
      const tree = await get<ResourceTreeResponse>(
        `/argocd/applications/${encodeURIComponent(name)}/resource-tree`,
      );
      return countPods(tree);
    },

    async sync(name: string, opts?: ArgoSyncOptions): Promise<void> {
      await post(`/argocd/applications/${encodeURIComponent(name)}/sync`, {
        prune: opts?.prune ?? false,
        force: opts?.force ?? false,
      });
    },

    async createApplication(spec: ArgoApplicationCreateSpec): Promise<void> {
      // Build the full upstream Argo CD Application JSON. The shape mirrors
      // the ApplicationSet template so manually registered services behave
      // identically to ApplicationSet-managed ones (same project, sync policy,
      // helm value files, label).
      const body = {
        metadata: {
          name: spec.name,
          namespace: "argocd",
          labels: {
            "app.kubernetes.io/part-of": "lw-idp",
          },
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
      };
      await post("/argocd/applications", body);
    },
  };
}
