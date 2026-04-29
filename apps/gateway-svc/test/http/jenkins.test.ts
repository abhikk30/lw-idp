import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { jenkinsPlugin } from "../../src/http/jenkins.js";
import { sessionPlugin } from "../../src/middleware/session.js";

function memorySession(): SessionStore {
  const m = new Map<string, SessionRecord>();
  return {
    async get(k) {
      return m.get(k);
    },
    async set(k, v, _o: SessionStoreSetOptions) {
      m.set(k, v);
    },
    async delete(k) {
      m.delete(k);
    },
    async close() {
      m.clear();
    },
  };
}

interface RecordedCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

type FakeFetchHandler = (call: RecordedCall) => Promise<Response> | Response;

/**
 * Build a fake `fetchImpl` that:
 *  - records every call into `recorded`
 *  - delegates to a swappable per-test handler
 */
function makeFakeFetch(): {
  recorded: RecordedCall[];
  setHandler: (h: FakeFetchHandler) => void;
  fetchImpl: typeof fetch;
} {
  const recorded: RecordedCall[] = [];
  let handler: FakeFetchHandler = () => new Response("{}", { status: 200 });

  const fetchImpl: typeof fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const method = (init?.method ?? "GET").toUpperCase();
    const headers: Record<string, string> = {};
    const rawHeaders = init?.headers ?? {};
    if (rawHeaders instanceof Headers) {
      rawHeaders.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(rawHeaders)) {
      for (const [k, v] of rawHeaders) {
        headers[k.toLowerCase()] = v;
      }
    } else {
      for (const [k, v] of Object.entries(rawHeaders)) {
        if (typeof v === "string") {
          headers[k.toLowerCase()] = v;
        }
      }
    }
    let body: unknown = undefined;
    if (typeof init?.body === "string") {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const call: RecordedCall = { url, method, headers, body };
    recorded.push(call);
    return handler(call);
  }) as typeof fetch;

  return {
    recorded,
    setHandler: (h) => {
      handler = h;
    },
    fetchImpl,
  };
}

// ── Shared setup helpers ──────────────────────────────────────────────────────

const JENKINS_BASE = "http://jenkins.jenkins.svc:8080";
const JENKINS_USERNAME = "idp-sa";
const JENKINS_TOKEN = "secret-api-token";
const EXPECTED_BASIC = `Basic ${Buffer.from(`${JENKINS_USERNAME}:${JENKINS_TOKEN}`).toString("base64")}`;

// ── Suites ────────────────────────────────────────────────────────────────────

describe("gateway /api/v1/jenkins/* — not configured (empty credentials)", () => {
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let fake: ReturnType<typeof makeFakeFetch>;

  beforeAll(async () => {
    sessionStore = memorySession();
    await sessionStore.set(
      "sess_ok",
      {
        userId: "u1",
        email: "user@test.com",
        displayName: "Test User",
        teams: [],
        idToken: "fake.jwt",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    fake = makeFakeFetch();

    // Plugin with EMPTY username and token — simulates fresh bootstrap.
    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(jenkinsPlugin, {
          jenkinsApiUrl: JENKINS_BASE,
          jenkinsUsername: "",
          jenkinsApiToken: "",
          fetchImpl: fake.fetchImpl,
        });
      },
    });
    const addr = await gateway.listen();
    gatewayUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 60_000);

  afterAll(async () => {
    await gateway?.close();
    await sessionStore?.close();
  });

  beforeEach(() => {
    fake.recorded.length = 0;
    fake.setHandler(() => {
      throw new Error("upstream should not be called when unconfigured");
    });
  });

  const okCookie = { cookie: "lw-sid=sess_ok" };

  it("T1: empty username → 503 jenkins_not_configured, no upstream call", async () => {
    // Even if we imagine username is empty but token is set, the gateway should
    // return 503. This suite has BOTH empty; we cover the "empty username" case.
    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("jenkins_not_configured");
    expect(body.message).toContain("docs/runbooks/jenkins-api-token.md");
    expect(fake.recorded).toHaveLength(0);
  });

  it("T2: empty token (with empty username) → 503 jenkins_not_configured, no upstream call", async () => {
    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout/builds`, {
      headers: okCookie,
    });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jenkins_not_configured");
    expect(fake.recorded).toHaveLength(0);
  });
});

describe("gateway /api/v1/jenkins/* — configured", () => {
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let sessionStore: SessionStore;
  let fake: ReturnType<typeof makeFakeFetch>;

  beforeAll(async () => {
    sessionStore = memorySession();
    await sessionStore.set(
      "sess_ok",
      {
        userId: "u1",
        email: "user@test.com",
        displayName: "Test User",
        teams: [],
        idToken: "fake.jwt",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    fake = makeFakeFetch();

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(jenkinsPlugin, {
          jenkinsApiUrl: JENKINS_BASE,
          jenkinsUsername: JENKINS_USERNAME,
          jenkinsApiToken: JENKINS_TOKEN,
          fetchImpl: fake.fetchImpl,
        });
      },
    });
    const addr = await gateway.listen();
    gatewayUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  }, 60_000);

  afterAll(async () => {
    await gateway?.close();
    await sessionStore?.close();
  });

  beforeEach(() => {
    fake.recorded.length = 0;
    fake.setHandler(() => new Response("{}", { status: 200 }));
  });

  const okCookie = { cookie: "lw-sid=sess_ok" };

  // T3: GET /jobs/:name — proxies with Basic auth
  it("T3: GET /jobs/checkout → upstream /job/checkout/api/json?tree=... with Basic auth header", async () => {
    const jobPayload = {
      name: "checkout",
      url: "http://jenkins/job/checkout/",
      description: "Checkout pipeline",
      lastBuild: { number: 42, result: "SUCCESS", timestamp: 1700000000000, duration: 60000 },
      lastSuccessfulBuild: { number: 42, timestamp: 1700000000000 },
      healthReport: [{ score: 100, description: "Build stable" }],
    };
    fake.setHandler(
      () =>
        new Response(JSON.stringify(jobPayload), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof jobPayload;
    expect(body.name).toBe("checkout");

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.method).toBe("GET");
    expect(call.url).toMatch(/\/job\/checkout\/api\/json\?tree=/);
    expect(call.headers.authorization).toBe(EXPECTED_BASIC);
  });

  // T4: GET /jobs/:name/builds?limit=5 → URL has {,5}
  it("T4: GET /jobs/checkout/builds?limit=5 → upstream URL contains builds[...]{,5}", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ builds: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout/builds?limit=5`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    // The tree parameter encodes {,5} — it will be URL-encoded
    expect(decodeURIComponent(call.url)).toContain("{,5}");
    expect(call.headers.authorization).toBe(EXPECTED_BASIC);
  });

  // T5: GET /builds with no limit → defaults to {,20}
  it("T5: GET /jobs/checkout/builds (no limit) → defaults to {,20} in upstream URL", async () => {
    fake.setHandler(
      () =>
        new Response(JSON.stringify({ builds: [] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout/builds`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);

    expect(fake.recorded).toHaveLength(1);
    expect(decodeURIComponent(fake.recorded[0].url)).toContain("{,20}");
  });

  // T6: POST /build happy path — crumb fetched first, then POST with crumb header + Location passed through
  it("T6: POST /jobs/checkout/build → gets crumb, POSTs with crumb header, returns 201 + location", async () => {
    let _callCount = 0;
    fake.setHandler((call) => {
      _callCount++;
      if (call.url.includes("/crumbIssuer/api/json")) {
        return new Response(JSON.stringify({ crumb: "xyz", crumbRequestField: "Jenkins-Crumb" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // Build trigger — Jenkins returns 201 with Location
      return new Response("", {
        status: 201,
        headers: {
          location: `${JENKINS_BASE}/queue/item/99/`,
        },
      });
    });

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout/build`, {
      method: "POST",
      headers: okCookie,
    });
    expect(res.status).toBe(201);

    // Verify two upstream calls were made
    expect(fake.recorded).toHaveLength(2);

    // First call: crumb
    expect(fake.recorded[0].url).toContain("/crumbIssuer/api/json");
    expect(fake.recorded[0].method).toBe("GET");
    expect(fake.recorded[0].headers.authorization).toBe(EXPECTED_BASIC);

    // Second call: build trigger
    expect(fake.recorded[1].url).toContain("/job/checkout/build");
    expect(fake.recorded[1].method).toBe("POST");
    expect(fake.recorded[1].headers.authorization).toBe(EXPECTED_BASIC);
    // Crumb header forwarded (lowercased by fake fetch)
    expect(fake.recorded[1].headers["jenkins-crumb"]).toBe("xyz");

    // Location header passed through in IDP response body
    const body = (await res.json()) as { location?: string };
    expect(body.location).toContain("/queue/item/99/");
  });

  // T7: upstream 404 → IDP 404 not_found with job name in message
  it("T7: upstream 404 → IDP 404 not_found, message includes job name", async () => {
    fake.setHandler(() => new Response("{}", { status: 404 }));

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/missing-job`, { headers: okCookie });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { code: string; message: string };
    expect(body.code).toBe("not_found");
    expect(body.message).toContain("missing-job");
  });

  // T8: upstream 5xx → IDP 503 jenkins_unavailable
  it("T8: upstream 5xx → IDP 503 jenkins_unavailable", async () => {
    fake.setHandler(() => new Response("{}", { status: 500 }));

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jenkins_unavailable");
  });

  // T9: upstream 401 → IDP 503 jenkins_unauthorized (NOT 401 — config error, not user-auth)
  it("T9: upstream 401 → IDP 503 jenkins_unauthorized (config error, not user-auth error)", async () => {
    fake.setHandler(() => new Response("{}", { status: 401 }));

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jenkins_unauthorized");
  });

  // T10: GET /builds/:number/console → upstream /consoleText, passes Content-Type: text/plain
  it("T10: GET /jobs/checkout/builds/42/console → upstream /job/checkout/42/consoleText, text/plain passthrough", async () => {
    const consoleOutput = "Started by user\nBuilding on master\nFinished: SUCCESS\n";
    fake.setHandler(
      () =>
        new Response(consoleOutput, {
          status: 200,
          headers: { "content-type": "text/plain; charset=utf-8" },
        }),
    );

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout/builds/42/console`, {
      headers: okCookie,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const text = await res.text();
    expect(text).toBe(consoleOutput);

    expect(fake.recorded).toHaveLength(1);
    const call = fake.recorded[0];
    expect(call.url).toContain("/job/checkout/42/consoleText");
    expect(call.method).toBe("GET");
    expect(call.headers.authorization).toBe(EXPECTED_BASIC);
  });

  // Bonus T11: network error (fetch throws) → 503 jenkins_unavailable
  it("T11: network error → 503 jenkins_unavailable", async () => {
    fake.setHandler(() => {
      throw new Error("ECONNREFUSED");
    });

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(503);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jenkins_unavailable");
  });

  // Bonus T12: upstream 403 → IDP 403 jenkins_forbidden
  it("T12: upstream 403 → IDP 403 jenkins_forbidden", async () => {
    fake.setHandler(() => new Response("{}", { status: 403 }));

    const res = await fetch(`${gatewayUrl}/api/v1/jenkins/jobs/checkout`, { headers: okCookie });
    expect(res.status).toBe(403);
    const body = (await res.json()) as { code: string };
    expect(body.code).toBe("jenkins_forbidden");
  });
});
