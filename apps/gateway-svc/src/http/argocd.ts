import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";

export interface ArgocdPluginOptions {
  /**
   * Base URL of the Argo CD API server, e.g.
   * `http://argocd-server.argocd.svc:80` (in-cluster) or
   * `http://argocd.lw-idp.local` (ingress).
   */
  argocdApiUrl: string;
  /**
   * Injectable for tests; defaults to the global `fetch` (Node 22 native).
   */
  fetchImpl?: typeof fetch;
}

interface SyncBody {
  prune?: boolean;
  force?: boolean;
}

/**
 * Map an upstream Argo CD response (or thrown network error) onto an IDP
 * error response. Mirrors the `mapConnectError` shape used elsewhere in
 * the gateway: returns `true` when an error response was sent.
 */
async function mapUpstreamError(
  upstream: Response,
  reply: FastifyReply,
  appName?: string,
): Promise<boolean> {
  if (upstream.ok) {
    return false;
  }
  if (upstream.status === 401) {
    reply.code(401).send({ code: "reauth_required", message: "argo cd rejected token" });
    return true;
  }
  if (upstream.status === 403) {
    reply.code(403).send({ code: "argocd_forbidden", message: "argo cd denied operation" });
    return true;
  }
  if (upstream.status === 404) {
    const message = appName
      ? `argo cd application not found: ${appName}`
      : "argo cd application not found";
    reply.code(404).send({ code: "not_found", message });
    return true;
  }
  if (upstream.status === 409) {
    let upstreamMessage = "application already exists";
    try {
      const body = (await upstream.json()) as { message?: string };
      if (typeof body.message === "string") {
        upstreamMessage = body.message;
      }
    } catch {
      // ignore
    }
    reply.code(409).send({ code: "argocd_conflict", message: upstreamMessage });
    return true;
  }
  if (upstream.status >= 500) {
    reply.code(503).send({ code: "deploy_plane_unavailable", message: "argo cd unavailable" });
    return true;
  }
  // Other 4xx — pass through status with a generic body.
  let body: unknown = undefined;
  try {
    body = await upstream.json();
  } catch {
    // ignore
  }
  reply.code(upstream.status).send(body ?? { code: "argocd_error", message: "argo cd error" });
  return true;
}

const argocdPluginFn: FastifyPluginAsync<ArgocdPluginOptions> = async (fastify, opts) => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.argocdApiUrl.replace(/\/+$/, "");

  /**
   * Look up the session and its `idToken`. Returns the bearer token on
   * success, or `null` if a 401 reply has already been sent.
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

  async function proxy(opts2: {
    method: "GET" | "POST";
    path: string;
    bearer: string;
    body?: unknown;
    reply: FastifyReply;
    appName?: string;
  }): Promise<FastifyReply | undefined> {
    const url = `${baseUrl}${opts2.path}`;
    const headers: Record<string, string> = {
      authorization: `Bearer ${opts2.bearer}`,
      accept: "application/json",
    };
    if (opts2.method === "POST") {
      headers["content-type"] = "application/json";
    }
    let upstream: Response;
    const init: RequestInit = { method: opts2.method, headers };
    if (opts2.body !== undefined) {
      init.body = JSON.stringify(opts2.body);
    }
    try {
      upstream = await fetchImpl(url, init);
    } catch (err) {
      fastify.log.error({ err, url, method: opts2.method }, "argocd upstream fetch failed");
      return opts2.reply
        .code(503)
        .send({ code: "deploy_plane_unavailable", message: "argo cd unavailable" });
    }
    if (await mapUpstreamError(upstream, opts2.reply, opts2.appName)) {
      return opts2.reply;
    }
    let payload: unknown = undefined;
    try {
      payload = await upstream.json();
    } catch {
      payload = {};
    }
    return opts2.reply.code(upstream.status).send(payload);
  }

  // GET /api/v1/argocd/applications  ->  GET /api/v1/applications?selector=...
  fastify.get("/api/v1/argocd/applications", async (req, reply) => {
    const bearer = getBearer(req, reply);
    if (!bearer) {
      return reply;
    }
    const selector = encodeURIComponent("app.kubernetes.io/part-of=lw-idp");
    return proxy({
      method: "GET",
      path: `/api/v1/applications?selector=${selector}`,
      bearer,
      reply,
    });
  });

  // GET /api/v1/argocd/applications/:name  ->  GET /api/v1/applications/:name
  fastify.get<{ Params: { name: string } }>(
    "/api/v1/argocd/applications/:name",
    async (req, reply) => {
      const bearer = getBearer(req, reply);
      if (!bearer) {
        return reply;
      }
      const name = encodeURIComponent(req.params.name);
      return proxy({
        method: "GET",
        path: `/api/v1/applications/${name}`,
        bearer,
        reply,
        appName: req.params.name,
      });
    },
  );

  // GET /api/v1/argocd/applications/:name/resource-tree
  //   ->  GET /api/v1/applications/:name/resource-tree
  fastify.get<{ Params: { name: string } }>(
    "/api/v1/argocd/applications/:name/resource-tree",
    async (req, reply) => {
      const bearer = getBearer(req, reply);
      if (!bearer) {
        return reply;
      }
      const name = encodeURIComponent(req.params.name);
      return proxy({
        method: "GET",
        path: `/api/v1/applications/${name}/resource-tree`,
        bearer,
        reply,
        appName: req.params.name,
      });
    },
  );

  // POST /api/v1/argocd/applications
  //   ->  POST /api/v1/applications
  // Body: an Argo CD Application spec (passed through verbatim). Argo CD validates the schema;
  // we only reject if the body is not a JSON object (array, string, null, etc.).
  fastify.post<{ Body: unknown }>("/api/v1/argocd/applications", async (req, reply) => {
    const bearer = getBearer(req, reply);
    if (!bearer) {
      return reply;
    }
    if (req.body === null || typeof req.body !== "object" || Array.isArray(req.body)) {
      return reply.code(400).send({ code: "invalid_body", message: "body must be a JSON object" });
    }
    return proxy({
      method: "POST",
      path: "/api/v1/applications",
      bearer,
      body: req.body,
      reply,
    });
  });

  // POST /api/v1/argocd/applications/:name/sync
  //   ->  POST /api/v1/applications/:name/sync
  // Body: { prune?, force? }  -> upstream { prune, dryRun: false, strategy: { hook: { force } } }
  fastify.post<{ Params: { name: string }; Body: SyncBody | undefined }>(
    "/api/v1/argocd/applications/:name/sync",
    async (req, reply) => {
      const bearer = getBearer(req, reply);
      if (!bearer) {
        return reply;
      }
      const body = req.body ?? {};
      const upstreamBody = {
        prune: body.prune ?? false,
        dryRun: false,
        strategy: { hook: { force: body.force ?? false } },
      };
      const name = encodeURIComponent(req.params.name);
      return proxy({
        method: "POST",
        path: `/api/v1/applications/${name}/sync`,
        bearer,
        body: upstreamBody,
        reply,
        appName: req.params.name,
      });
    },
  );
};

export const argocdPlugin = fp(argocdPluginFn, {
  name: "lw-idp-argocd",
  dependencies: ["lw-idp-session"],
});
