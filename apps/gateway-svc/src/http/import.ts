import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";
import type { CatalogClient } from "../clients/catalog.js";

export interface ImportPluginOptions {
  /**
   * Base URL of the Argo CD API server, e.g.
   * `http://argocd-server.argocd.svc:80` (in-cluster) or
   * `http://argocd.lw-idp.local` (ingress).
   */
  argocdApiUrl: string;
  /**
   * gRPC catalog client (same one injected into servicesPlugin).
   */
  catalogClient: CatalogClient;
  /**
   * Injectable for tests; defaults to the global `fetch` (Node 22 native).
   */
  fetchImpl?: typeof fetch;
}

/** Minimal Argo CD application shape we care about for the diff. */
interface ArgoApp {
  metadata: { name: string };
  spec: {
    source: {
      repoURL?: string;
      targetRevision?: string;
      path?: string;
    };
    destination: {
      namespace?: string;
    };
  };
  status?: {
    sync?: { status?: string; revision?: string };
    health?: { status?: string };
  };
}

interface ArgoAppListResponse {
  items?: ArgoApp[];
}

interface ImportCandidate {
  name: string;
  repoUrl: string;
  targetRevision: string;
  path: string;
  destinationNamespace: string;
  sync: { status: string; revision?: string };
  health: { status: string };
}

/**
 * Extract the bearer token from the session's idToken field.
 * Returns `null` if a 401 has already been sent.
 */
function getBearer(req: { session?: { idToken?: string } }, reply: FastifyReply): string | null {
  if (!req.session) {
    reply.code(401).send({ code: "unauthorized", message: "session required" });
    return null;
  }
  const token = req.session.idToken;
  if (!token) {
    reply
      .code(401)
      .send({ code: "reauth_required", message: "session has no id_token; re-authenticate" });
    return null;
  }
  return token;
}

const importPluginFn: FastifyPluginAsync<ImportPluginOptions> = async (fastify, opts) => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.argocdApiUrl.replace(/\/+$/, "");

  /**
   * GET /api/v1/services/import-candidates
   *
   * Returns the set difference: Argo CD apps (labelled app.kubernetes.io/part-of=lw-idp)
   * whose `metadata.name` does NOT match any catalog service slug. These are
   * "orphaned" Argo CD apps that have not been imported into the IDP catalog yet.
   */
  fastify.get("/api/v1/services/import-candidates", async (req, reply) => {
    const bearer = getBearer(req, reply);
    if (!bearer) {
      return reply;
    }

    const selector = encodeURIComponent("app.kubernetes.io/part-of=lw-idp");
    const argoUrl = `${baseUrl}/api/v1/applications?selector=${selector}`;

    // Fan out: fetch Argo CD apps and catalog services in parallel.
    let argoResponse: Response;
    let catalogResult: { services: Array<{ slug: string }> };

    try {
      [argoResponse, catalogResult] = await Promise.all([
        fetchImpl(argoUrl, {
          method: "GET",
          headers: {
            authorization: `Bearer ${bearer}`,
            accept: "application/json",
          },
        }),
        opts.catalogClient.listServices({}).catch((err: unknown) => {
          // Re-throw with a sentinel so we can distinguish catalog errors below.
          const wrapped = new Error("catalog_grpc_error");
          (wrapped as Error & { cause?: unknown }).cause = err;
          (wrapped as Error & { isCatalogError?: boolean }).isCatalogError = true;
          throw wrapped;
        }),
      ]);
    } catch (err: unknown) {
      // If the thrown error is a network error from fetch (Argo CD unreachable):
      if (err instanceof Error && (err as Error & { isCatalogError?: boolean }).isCatalogError) {
        fastify.log.error({ err }, "catalog-svc gRPC call failed");
        return reply
          .code(502)
          .send({ code: "catalog_unavailable", message: "catalog service unavailable" });
      }
      // Argo CD network/fetch error
      fastify.log.error({ err }, "argocd upstream fetch failed for import-candidates");
      return reply
        .code(503)
        .send({ code: "deploy_plane_unavailable", message: "argo cd unavailable" });
    }

    // Map upstream Argo CD HTTP error codes.
    if (!argoResponse.ok) {
      if (argoResponse.status === 401) {
        return reply.code(401).send({ code: "reauth_required", message: "argo cd rejected token" });
      }
      if (argoResponse.status >= 500) {
        return reply
          .code(503)
          .send({ code: "deploy_plane_unavailable", message: "argo cd unavailable" });
      }
      return reply
        .code(argoResponse.status)
        .send({ code: "argocd_error", message: "argo cd error" });
    }

    let argoBody: ArgoAppListResponse;
    try {
      argoBody = (await argoResponse.json()) as ArgoAppListResponse;
    } catch {
      argoBody = {};
    }

    const argoApps: ArgoApp[] = argoBody.items ?? [];

    // Build the catalog slug set for O(1) lookup.
    const catalogSlugs = new Set<string>(catalogResult.services.map((s) => s.slug));

    // Keep only Argo CD apps not already in the catalog.
    const candidates: ImportCandidate[] = argoApps
      .filter((app) => !catalogSlugs.has(app.metadata.name))
      .map((app) => {
        const src = app.spec?.source ?? {};
        const dst = app.spec?.destination ?? {};
        const sync = app.status?.sync ?? {};
        const health = app.status?.health ?? {};
        const candidate: ImportCandidate = {
          name: app.metadata.name,
          repoUrl: src.repoURL ?? "",
          targetRevision: src.targetRevision ?? "",
          path: src.path ?? "",
          destinationNamespace: dst.namespace ?? "",
          sync: {
            status: sync.status ?? "Unknown",
            ...(sync.revision ? { revision: sync.revision } : {}),
          },
          health: { status: health.status ?? "Unknown" },
        };
        return candidate;
      });

    return reply.code(200).send({ candidates });
  });
};

export const importPlugin = fp(importPluginFn, {
  name: "lw-idp-import",
  dependencies: ["lw-idp-session"],
});
