import type { FastifyPluginAsync, FastifyReply } from "fastify";
import fp from "fastify-plugin";

export interface JenkinsPluginOptions {
  /** Base URL of the Jenkins controller, e.g. http://jenkins.jenkins.svc:8080 */
  jenkinsApiUrl: string;
  /** Service-account username for Basic auth. Empty string = not configured. */
  jenkinsUsername: string;
  /** Service-account API token for Basic auth. Empty string = not configured. */
  jenkinsApiToken: string;
  /** Injectable for tests; defaults to global fetch. */
  fetchImpl?: typeof fetch;
}

const NOT_CONFIGURED_MESSAGE =
  "Jenkins API token not yet configured — see docs/runbooks/jenkins-api-token.md";

/**
 * Map an upstream Jenkins response (or thrown network error) onto an IDP
 * error response. Returns `true` when an error response was sent.
 */
async function mapUpstreamError(
  upstream: Response,
  reply: FastifyReply,
  jobName?: string,
): Promise<boolean> {
  if (upstream.ok) {
    return false;
  }
  if (upstream.status === 401) {
    // 503 not 401 — this is a configuration error (bad token), not a user-auth error.
    reply.code(503).send({
      code: "jenkins_unauthorized",
      message: "Jenkins rejected the API token; rotate it via the runbook",
    });
    return true;
  }
  if (upstream.status === 403) {
    reply.code(403).send({
      code: "jenkins_forbidden",
      message: "Jenkins denied operation — service account lacks permission",
    });
    return true;
  }
  if (upstream.status === 404) {
    const message = jobName ? `Jenkins job not found: ${jobName}` : "Jenkins job not found";
    reply.code(404).send({ code: "not_found", message });
    return true;
  }
  if (upstream.status >= 500) {
    reply.code(503).send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
    return true;
  }
  // Other 4xx — pass through status with a generic body.
  let body: unknown = undefined;
  try {
    body = await upstream.json();
  } catch {
    // ignore
  }
  reply.code(upstream.status).send(body ?? { code: "jenkins_error", message: "Jenkins error" });
  return true;
}

const jenkinsPluginFn: FastifyPluginAsync<JenkinsPluginOptions> = async (fastify, opts) => {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.jenkinsApiUrl.replace(/\/+$/, "");

  /**
   * Check that the Jenkins credentials are configured. If not, sends a 503 and returns false.
   */
  function checkConfigured(reply: FastifyReply): boolean {
    if (!opts.jenkinsUsername || !opts.jenkinsApiToken) {
      reply.code(503).send({ code: "jenkins_not_configured", message: NOT_CONFIGURED_MESSAGE });
      return false;
    }
    return true;
  }

  /**
   * Build the Basic auth header value from the configured credentials.
   */
  function basicAuth(): string {
    const credentials = `${opts.jenkinsUsername}:${opts.jenkinsApiToken}`;
    return `Basic ${Buffer.from(credentials).toString("base64")}`;
  }

  /**
   * Fetch a CSRF crumb from Jenkins. Returns `{ crumbRequestField, crumb }` or
   * throws (caller converts to 503).
   */
  async function fetchCrumb(): Promise<{ crumbRequestField: string; crumb: string }> {
    const url = `${baseUrl}/crumbIssuer/api/json`;
    const upstream = await fetchImpl(url, {
      method: "GET",
      headers: {
        authorization: basicAuth(),
        accept: "application/json",
      },
    });
    if (!upstream.ok) {
      throw new Error(`Crumb fetch failed with status ${upstream.status}`);
    }
    const data = (await upstream.json()) as { crumbRequestField: string; crumb: string };
    return data;
  }

  // GET /api/v1/jenkins/jobs/:name
  //   -> GET /job/{name}/api/json?tree=<fields>
  fastify.get<{ Params: { name: string } }>("/api/v1/jenkins/jobs/:name", async (req, reply) => {
    if (!checkConfigured(reply)) {
      return reply;
    }

    const name = encodeURIComponent(req.params.name);
    const tree =
      "name,url,description,lastBuild[number,result,timestamp,duration],lastSuccessfulBuild[number,timestamp],healthReport[score,description]";
    const url = `${baseUrl}/job/${name}/api/json?tree=${encodeURIComponent(tree)}`;

    let upstream: Response;
    try {
      upstream = await fetchImpl(url, {
        method: "GET",
        headers: {
          authorization: basicAuth(),
          accept: "application/json",
        },
      });
    } catch (err) {
      fastify.log.error({ err, url }, "jenkins upstream fetch failed");
      return reply.code(503).send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
    }

    if (await mapUpstreamError(upstream, reply, req.params.name)) {
      return reply;
    }

    let payload: unknown;
    try {
      payload = await upstream.json();
    } catch {
      payload = {};
    }
    return reply.code(upstream.status).send(payload);
  });

  // GET /api/v1/jenkins/jobs/:name/builds
  //   -> GET /job/{name}/api/json?tree=builds[...]{,N}
  fastify.get<{ Params: { name: string }; Querystring: { limit?: string } }>(
    "/api/v1/jenkins/jobs/:name/builds",
    async (req, reply) => {
      if (!checkConfigured(reply)) {
        return reply;
      }

      const rawLimit = Number(req.query.limit ?? 20);
      const limit = Math.min(100, Math.max(1, Number.isFinite(rawLimit) ? rawLimit : 20));

      const name = encodeURIComponent(req.params.name);
      const fields =
        "builds[number,result,timestamp,duration,url,actions[parameters[name,value],causes[shortDescription,userId,userName],lastBuiltRevision[SHA1,branch[name]]]]";
      const tree = `${fields}{,${limit}}`;
      const url = `${baseUrl}/job/${name}/api/json?tree=${encodeURIComponent(tree)}`;

      let upstream: Response;
      try {
        upstream = await fetchImpl(url, {
          method: "GET",
          headers: {
            authorization: basicAuth(),
            accept: "application/json",
          },
        });
      } catch (err) {
        fastify.log.error({ err, url }, "jenkins upstream fetch failed");
        return reply
          .code(503)
          .send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
      }

      if (await mapUpstreamError(upstream, reply, req.params.name)) {
        return reply;
      }

      let payload: unknown;
      try {
        payload = await upstream.json();
      } catch {
        payload = {};
      }
      return reply.code(upstream.status).send(payload);
    },
  );

  // POST /api/v1/jenkins/jobs/:name/build
  //   -> GET /crumbIssuer/api/json, then POST /job/{name}/build
  fastify.post<{ Params: { name: string } }>(
    "/api/v1/jenkins/jobs/:name/build",
    async (req, reply) => {
      if (!checkConfigured(reply)) {
        return reply;
      }

      const name = encodeURIComponent(req.params.name);

      // Fetch CSRF crumb first (Jenkins CSRF protection is on by default).
      let crumbField: string;
      let crumbValue: string;
      try {
        const crumbData = await fetchCrumb();
        crumbField = crumbData.crumbRequestField;
        crumbValue = crumbData.crumb;
      } catch (err) {
        fastify.log.error({ err }, "jenkins crumb fetch failed");
        return reply
          .code(503)
          .send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
      }

      const url = `${baseUrl}/job/${name}/build`;
      let upstream: Response;
      try {
        upstream = await fetchImpl(url, {
          method: "POST",
          headers: {
            authorization: basicAuth(),
            accept: "application/json",
            [crumbField]: crumbValue,
          },
        });
      } catch (err) {
        fastify.log.error({ err, url }, "jenkins upstream fetch failed");
        return reply
          .code(503)
          .send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
      }

      if (await mapUpstreamError(upstream, reply, req.params.name)) {
        return reply;
      }

      // Jenkins returns 201 with a Location header pointing at the queue item.
      const location = upstream.headers.get("location");
      const responseBody: Record<string, string> = { status: "queued" };
      if (location) {
        responseBody.location = location;
      }
      return reply
        .code(201)
        .headers({ location: location ?? "" })
        .send(responseBody);
    },
  );

  // GET /api/v1/jenkins/jobs/:name/builds/:number/console
  //   -> GET /job/{name}/{number}/consoleText
  fastify.get<{ Params: { name: string; number: string } }>(
    "/api/v1/jenkins/jobs/:name/builds/:number/console",
    async (req, reply) => {
      if (!checkConfigured(reply)) {
        return reply;
      }

      const name = encodeURIComponent(req.params.name);
      const buildNumber = encodeURIComponent(req.params.number);
      const url = `${baseUrl}/job/${name}/${buildNumber}/consoleText`;

      let upstream: Response;
      try {
        upstream = await fetchImpl(url, {
          method: "GET",
          headers: {
            authorization: basicAuth(),
          },
        });
      } catch (err) {
        fastify.log.error({ err, url }, "jenkins upstream fetch failed");
        return reply
          .code(503)
          .send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
      }

      if (upstream.status === 401) {
        return reply.code(503).send({
          code: "jenkins_unauthorized",
          message: "Jenkins rejected the API token; rotate it via the runbook",
        });
      }
      if (upstream.status === 403) {
        return reply.code(403).send({
          code: "jenkins_forbidden",
          message: "Jenkins denied operation — service account lacks permission",
        });
      }
      if (upstream.status === 404) {
        return reply.code(404).send({
          code: "not_found",
          message: `Jenkins job not found: ${req.params.name}`,
        });
      }
      if (upstream.status >= 500) {
        return reply
          .code(503)
          .send({ code: "jenkins_unavailable", message: "Jenkins unreachable" });
      }
      if (!upstream.ok) {
        return reply
          .code(upstream.status)
          .send({ code: "jenkins_error", message: "Jenkins error" });
      }

      const text = await upstream.text();
      return reply.code(upstream.status).header("content-type", "text/plain").send(text);
    },
  );
};

export const jenkinsPlugin = fp(jenkinsPluginFn, {
  name: "lw-idp-jenkins",
  dependencies: ["lw-idp-session"],
});
