import * as fs from "node:fs";
import { Agent, fetch as undiciFetch } from "undici";

export interface K8sPod {
  name: string;
  phase: string;
  ready: boolean;
  started_at: string | null;
  restart_count: number;
  node: string | null;
}

export interface K8sClient {
  listPods(namespace: string, labelSelector?: string): Promise<K8sPod[]>;
  /**
   * Generic CRD list. `apiVersion` is the CRD's `<group>/<version>` (e.g.
   * "aquasecurity.github.io/v1alpha1"); `kind` is the lowercase plural
   * (e.g. "vulnerabilityreports"). Omit `namespace` to list cluster-scoped
   * resources or all-namespaces. On 404 (CRD not registered) the returned
   * Error message contains "404" so route handlers can translate to
   * `503 trivy_not_installed` via substring match.
   */
  listCustomResources(opts: {
    apiVersion: string;
    kind: string;
    namespace?: string;
  }): Promise<Record<string, unknown>[]>;
}

export interface K8sClientOpts {
  baseUrl?: string;
  bearerToken?: string;
  caPath?: string;
  // Test escape hatch — if set, bypasses node:https Agent (used in localhost http test stubs).
  insecureHttp?: boolean;
}

interface K8sPodApi {
  metadata: { name: string };
  spec: { nodeName?: string };
  status: {
    phase: string;
    startTime?: string;
    containerStatuses?: Array<{ ready: boolean; restartCount: number }>;
  };
}

export function createK8sClient(opts: K8sClientOpts = {}): K8sClient {
  const baseUrl = opts.baseUrl ?? "https://kubernetes.default.svc";
  const token =
    opts.bearerToken ?? readIfExists("/var/run/secrets/kubernetes.io/serviceaccount/token");
  const caPath = opts.caPath ?? "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt";
  const ca = !opts.insecureHttp ? readIfExists(caPath) : undefined;
  // Pin the cluster CA so the kubelet's self-signed serving cert verifies. We
  // route through undici's fetch (not Node's globalThis.fetch) so we can pass
  // a dispatcher; globalThis.fetch ignores `dispatcher` per the spec.
  const dispatcher = ca ? new Agent({ connect: { ca } }) : undefined;

  return {
    async listPods(namespace, labelSelector) {
      const url = new URL(`/api/v1/namespaces/${encodeURIComponent(namespace)}/pods`, baseUrl);
      if (labelSelector) {
        url.searchParams.set("labelSelector", labelSelector);
      }
      const res = await undiciFetch(url, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (!res.ok) {
        throw new Error(`k8s list pods failed: ${res.status}`);
      }
      const json = (await res.json()) as { items: K8sPodApi[] };
      return json.items.map(toPod);
    },

    async listCustomResources({ apiVersion, kind, namespace }) {
      const [group, version] = apiVersion.split("/");
      if (!group || !version) {
        throw new Error(`invalid apiVersion: ${apiVersion}`);
      }
      const path = namespace
        ? `/apis/${group}/${version}/namespaces/${encodeURIComponent(namespace)}/${kind}`
        : `/apis/${group}/${version}/${kind}`;
      const url = new URL(path, baseUrl);
      const res = await undiciFetch(url, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
        ...(dispatcher ? { dispatcher } : {}),
      });
      if (!res.ok) {
        throw new Error(`k8s list ${kind} failed: ${res.status}`);
      }
      const json = (await res.json()) as { items?: Record<string, unknown>[] };
      return (json.items ?? []) as Record<string, unknown>[];
    },
  };
}

function readIfExists(p: string): string | undefined {
  try {
    return fs.readFileSync(p, "utf8").trim();
  } catch {
    return undefined;
  }
}

function toPod(p: K8sPodApi): K8sPod {
  const cs = p.status.containerStatuses ?? [];
  const ready = cs.length > 0 && cs.every((c) => c.ready);
  const restart_count = cs.reduce((acc, c) => acc + c.restartCount, 0);
  return {
    name: p.metadata.name,
    phase: p.status.phase,
    ready,
    started_at: p.status.startTime ?? null,
    restart_count,
    node: p.spec.nodeName ?? null,
  };
}
