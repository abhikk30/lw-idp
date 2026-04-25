import http from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { type SessionRecord, createRedisSessionStore } from "@lw-idp/auth";
import { CatalogService, Lifecycle, ServiceType } from "@lw-idp/contracts/catalog/v1";
import { ClusterService, Environment, Provider } from "@lw-idp/contracts/cluster/v1";
import { openWsClient } from "@lw-idp/testing";
import { execa } from "execa";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

// Resolve the monorepo root (test/e2e is two levels below root).
const repoRoot = join(fileURLToPath(import.meta.url), "..", "..", "..", "..");

async function kubectl(...args: string[]): Promise<string> {
  const { stdout } = await execa("kubectl", args, { reject: false });
  return stdout;
}

describe("cluster bootstrap", () => {
  it("has kubectx set to kind-lw-idp-dev", async () => {
    const ctx = (await kubectl("config", "current-context")).trim();
    expect(ctx).toBe("kind-lw-idp-dev");
  });

  it("has Postgres cluster Ready", async () => {
    const out = await kubectl(
      "-n",
      "lwidp-data",
      "get",
      "cluster/pg",
      "-o",
      "jsonpath={.status.phase}",
    );
    expect(out).toMatch(/Cluster in healthy state/i);
  });

  it("has NATS streams present", async () => {
    const out = await kubectl(
      "-n",
      "nats-system",
      "get",
      "streams.jetstream.nats.io",
      "-o",
      "name",
    );
    expect(out).toContain("stream.jetstream.nats.io/idp-domain");
    expect(out).toContain("stream.jetstream.nats.io/idp-audit");
  });

  it("has Dragonfly instance Ready", async () => {
    const out = await kubectl(
      "-n",
      "dragonfly-system",
      "get",
      "dragonfly/df",
      "-o",
      "jsonpath={.status.phase}",
    );
    expect(out.toLowerCase()).toBe("ready");
  });

  it("has Grafana deployment Available", async () => {
    const out = await kubectl(
      "-n",
      "observability",
      "get",
      "deploy",
      "-l",
      "app.kubernetes.io/name=grafana",
      "-o",
      "jsonpath={.items[*].status.conditions[?(@.type=='Available')].status}",
    );
    expect(out.trim()).toBe("True");
  });

  it("cluster-doctor.sh exits 0", async () => {
    const { exitCode } = await execa("./scripts/cluster-doctor.sh", ["dev"], {
      reject: false,
      cwd: repoRoot,
    });
    expect(exitCode).toBe(0);
  });
});

describe("lw-idp service healthz", () => {
  const services = [
    { name: "gateway-svc", expected: "gateway-svc", port: 14000 },
    { name: "identity-svc", expected: "identity-svc", port: 14001 },
    { name: "catalog-svc", expected: "catalog-svc", port: 14002 },
    { name: "cluster-svc", expected: "cluster-svc", port: 14003 },
    { name: "notification-svc", expected: "notification-svc", port: 14004 },
  ];

  type PortForward = { kill: () => void };
  const pfs: PortForward[] = [];

  beforeAll(async () => {
    for (const { name, port } of services) {
      const child = execa("kubectl", ["-n", "lw-idp", "port-forward", `svc/${name}`, `${port}:80`]);
      // Suppress unhandled rejection when the process is killed via SIGTERM.
      child.catch(() => {});
      pfs.push({
        kill: () => {
          child.kill("SIGTERM");
        },
      });
    }
    await new Promise((r) => setTimeout(r, 3_000));
  }, 30_000);

  afterAll(() => {
    for (const pf of pfs) {
      pf.kill();
    }
  });

  for (const { name, expected, port } of services) {
    it(`${name} /healthz responds 200 with correct service name`, async () => {
      const res = await fetch(`http://localhost:${port}/healthz`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", service: expected });
    });
  }

  it("web /api/healthz responds 200", async () => {
    const child = execa("kubectl", ["-n", "lw-idp", "port-forward", "svc/web", "13001:80"]);
    // Suppress unhandled rejection when the process is killed via SIGTERM.
    child.catch(() => {});
    try {
      await new Promise((r) => setTimeout(r, 2_000));
      const res = await fetch("http://localhost:13001/api/healthz");
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: "ok", service: "web" });
    } finally {
      child.kill("SIGTERM");
    }
  });
});

describe("catalog-svc + cluster-svc ConnectRPC + NATS events", () => {
  let catalogPf: ReturnType<typeof execa> | undefined;
  let clusterPf: ReturnType<typeof execa> | undefined;
  let natsPf: ReturnType<typeof execa> | undefined;
  let nc: NatsConnection | undefined;

  const streamName = "IDP_DOMAIN";

  beforeAll(async () => {
    // Port-forward the three services concurrently
    catalogPf = execa("kubectl", ["-n", "lw-idp", "port-forward", "svc/catalog-svc", "14002:80"]);
    clusterPf = execa("kubectl", ["-n", "lw-idp", "port-forward", "svc/cluster-svc", "14003:80"]);
    natsPf = execa("kubectl", ["-n", "nats-system", "port-forward", "svc/nats", "14222:4222"]);
    // Suppress unhandled rejections on SIGTERM
    catalogPf.catch(() => {});
    clusterPf.catch(() => {});
    natsPf.catch(() => {});
    await new Promise((r) => setTimeout(r, 3_000));

    nc = await natsConnect({ servers: "nats://127.0.0.1:14222" });
    const jsm = await nc.jetstreamManager();

    // Ephemeral consumers for this test run only — unique names avoid collisions.
    const ts = Date.now();
    try {
      await jsm.consumers.add(streamName, {
        name: `e2e-catalog-${ts}`,
        filter_subject: "idp.catalog.service.created",
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
      });
    } catch {
      // stream may already have max-consumers defined; skip if duplicate
    }
    try {
      await jsm.consumers.add(streamName, {
        name: `e2e-cluster-${ts}`,
        filter_subject: "idp.cluster.cluster.registered",
        ack_policy: AckPolicy.Explicit,
        deliver_policy: DeliverPolicy.New,
      });
    } catch {
      // ignore
    }

    // Save consumer names for use in tests below via closure
    (globalThis as { __catalogConsumer__?: string }).__catalogConsumer__ = `e2e-catalog-${ts}`;
    (globalThis as { __clusterConsumer__?: string }).__clusterConsumer__ = `e2e-cluster-${ts}`;
  }, 30_000);

  afterAll(async () => {
    await nc?.drain();
    catalogPf?.kill("SIGTERM");
    clusterPf?.kill("SIGTERM");
    natsPf?.kill("SIGTERM");
  });

  it("CreateService via ConnectRPC produces idp.catalog.service.created on NATS", async () => {
    const transport = createConnectTransport({
      baseUrl: "http://127.0.0.1:14002",
      httpVersion: "1.1",
    });
    const client = createClient(CatalogService, transport);

    const slug = `e2e-svc-${Date.now()}`;
    const created = await client.createService({
      slug,
      name: "E2E Service",
      description: "end-to-end test",
      type: ServiceType.SERVICE,
      lifecycle: Lifecycle.EXPERIMENTAL,
      tags: ["e2e"],
    });
    expect(created.service?.slug).toBe(slug);

    // Pull the event from NATS
    if (!nc) {
      throw new Error("NATS connection not established");
    }
    const js = nc.jetstream();
    const consumerName = (globalThis as { __catalogConsumer__?: string }).__catalogConsumer__;
    if (!consumerName) {
      throw new Error("catalog consumer name not set");
    }
    const consumer = await js.consumers.get(streamName, consumerName);
    const iter = await consumer.consume({ max_messages: 5 });
    const codec = JSONCodec();
    const timer = setTimeout(() => {
      iter.stop();
    }, 6_000);
    let seenSlug: string | undefined;
    for await (const m of iter) {
      const env = codec.decode(m.data) as { data?: { slug?: string } };
      m.ack();
      if (env.data?.slug === slug) {
        seenSlug = env.data.slug;
        break;
      }
    }
    clearTimeout(timer);
    expect(seenSlug).toBe(slug);
  }, 30_000);

  it("RegisterCluster via ConnectRPC produces idp.cluster.cluster.registered on NATS", async () => {
    const transport = createConnectTransport({
      baseUrl: "http://127.0.0.1:14003",
      httpVersion: "1.1",
    });
    const client = createClient(ClusterService, transport);

    const slug = `e2e-cluster-${Date.now()}`;
    const registered = await client.registerCluster({
      slug,
      name: "E2E Cluster",
      environment: Environment.DEV,
      provider: Provider.KIND,
      apiEndpoint: "https://127.0.0.1:6443",
      tags: ["e2e"],
    });
    expect(registered.cluster?.slug).toBe(slug);

    // Pull the event from NATS
    if (!nc) {
      throw new Error("NATS connection not established");
    }
    const js = nc.jetstream();
    const consumerName = (globalThis as { __clusterConsumer__?: string }).__clusterConsumer__;
    if (!consumerName) {
      throw new Error("cluster consumer name not set");
    }
    const consumer = await js.consumers.get(streamName, consumerName);
    const iter = await consumer.consume({ max_messages: 5 });
    const codec = JSONCodec();
    const timer = setTimeout(() => {
      iter.stop();
    }, 6_000);
    let seenSlug: string | undefined;
    for await (const m of iter) {
      const env = codec.decode(m.data) as { data?: { slug?: string } };
      m.ack();
      if (env.data?.slug === slug) {
        seenSlug = env.data.slug;
        break;
      }
    }
    clearTimeout(timer);
    expect(seenSlug).toBe(slug);
  }, 30_000);
});

// ---------------------------------------------------------------------------
// Low-level HTTP helper that lets us set an explicit Host header so that
// requests through the port-forwarded ingress-nginx controller are routed
// to the correct virtual host (portal.lw-idp.local).
// Node's native fetch / undici derives the Host header from the URL authority
// and silently ignores an explicit override, so we use http.request instead.
// ---------------------------------------------------------------------------
function requestWithHost(
  url: string,
  host: string,
  extra?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "GET",
        headers: { host, ...(extra ?? {}) },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("gateway-svc browser-flow surface via ingress", () => {
  let ingressPf: ReturnType<typeof execa> | undefined;

  beforeAll(async () => {
    // Port-forward ingress-nginx controller on 14080:80
    ingressPf = execa("kubectl", [
      "-n",
      "ingress-nginx",
      "port-forward",
      "svc/ingress-nginx-controller",
      "14080:80",
    ]);
    // Prevent unhandled SIGTERM rejection from vitest's worker cleanup
    ingressPf.catch(() => {});
    await new Promise((r) => setTimeout(r, 3_000));
  }, 30_000);

  afterAll(() => {
    ingressPf?.kill("SIGTERM");
  });

  it("/healthz returns 200 through the ingress", async () => {
    const res = await requestWithHost("http://127.0.0.1:14080/healthz", "portal.lw-idp.local");
    expect(res.status).toBe(200);
    const body = JSON.parse(res.body) as { status: string; service: string };
    expect(body.status).toBe("ok");
    expect(body.service).toBe("gateway-svc");
  });

  it("/auth/login redirects to a Dex authorize URL with PKCE + state", async () => {
    const res = await requestWithHost("http://127.0.0.1:14080/auth/login", "portal.lw-idp.local");
    expect(res.status).toBe(302);
    const loc = (res.headers.location as string) ?? "";
    expect(loc).toContain("/auth?");
    expect(loc).toContain("response_type=code");
    expect(loc).toContain("client_id=lw-idp-gateway");
    expect(loc).toContain("code_challenge=");
    expect(loc).toContain("code_challenge_method=S256");
    expect(loc).toContain("state=");
  });

  it("/api/v1/me without session cookie returns 401", async () => {
    const res = await requestWithHost("http://127.0.0.1:14080/api/v1/me", "portal.lw-idp.local");
    expect(res.status).toBe(401);
    const body = JSON.parse(res.body) as { code: string };
    expect(body.code).toBe("unauthorized");
  });

  it("/api/v1/services without session cookie returns 401", async () => {
    const res = await requestWithHost(
      "http://127.0.0.1:14080/api/v1/services",
      "portal.lw-idp.local",
    );
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// POST helper that mirrors requestWithHost but allows a JSON body, cookie,
// and Idempotency-Key. Kept local because it's only used by the WS fan-out
// describe below.
// ---------------------------------------------------------------------------
function postJsonWithHost(
  url: string,
  host: string,
  body: unknown,
  extra?: Record<string, string>,
): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  const payload = JSON.stringify(body);
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        method: "POST",
        headers: {
          host,
          "content-type": "application/json",
          "content-length": Buffer.byteLength(payload).toString(),
          ...(extra ?? {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => {
          data += c;
        });
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, headers: res.headers, body: data }),
        );
      },
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

describe("notification-svc WS fan-out via ingress", () => {
  // Stable seed identifiers. The user `gh|c3-smoke` and team `platform-admins`
  // are created once during the C3 smoke test (see plan §"Live verification (C3)")
  // and persisted in the kind-lw-idp-dev cluster. Each test run seeds a fresh
  // session in Dragonfly under a unique sid so we don't race with other tests
  // (or wscat sessions left around by a developer).
  const SEED_USER_ID = "c48c7b8c-ee6f-43ec-a8d3-a22425919653";
  const SEED_USER_SUBJECT = "gh|c3-smoke";
  const SEED_TEAM_ID = "886dbc66-bbaf-45ef-8995-25d390135f9e";
  const SEED_TEAM_SLUG = "platform-admins";

  let ingressPf: ReturnType<typeof execa> | undefined;
  let dragonflyPf: ReturnType<typeof execa> | undefined;
  let sessionStoreClose: (() => Promise<void>) | undefined;
  let deleteSession: (() => Promise<void>) | undefined;
  let sid: string;

  const ingressPort = 14081; // distinct from the gateway describe (14080)
  const dragonflyPort = 16379;

  beforeAll(async () => {
    // Port-forward ingress-nginx (HTTP + WS) on a dedicated port.
    ingressPf = execa("kubectl", [
      "-n",
      "ingress-nginx",
      "port-forward",
      "svc/ingress-nginx-controller",
      `${ingressPort}:80`,
    ]);
    ingressPf.catch(() => {});

    // Port-forward Dragonfly so we can seed a session via ioredis.
    dragonflyPf = execa("kubectl", [
      "-n",
      "dragonfly-system",
      "port-forward",
      "svc/df",
      `${dragonflyPort}:6379`,
    ]);
    dragonflyPf.catch(() => {});

    // Allow port-forwards to bind.
    await new Promise((r) => setTimeout(r, 3_000));

    // Seed the session record at lw-idp:session:<sid> with a fresh sid per run.
    sid = `sess_e2e_d1_${Date.now()}`;
    const sessionStore = createRedisSessionStore({
      url: `redis://127.0.0.1:${dragonflyPort}`,
    });
    sessionStoreClose = () => sessionStore.close();
    const session: SessionRecord = {
      userId: SEED_USER_ID,
      subject: SEED_USER_SUBJECT,
      email: "c3-smoke@test",
      displayName: "C3 Smoke",
      teams: [{ id: SEED_TEAM_ID, slug: SEED_TEAM_SLUG, name: "Platform Admins" }],
      createdAt: new Date().toISOString(),
    };
    await sessionStore.set(sid, session, { ttlSeconds: 600 });
    deleteSession = async () => {
      await sessionStore.delete(sid);
    };
  }, 60_000);

  afterAll(async () => {
    try {
      await deleteSession?.();
    } catch {
      // best-effort
    }
    try {
      await sessionStoreClose?.();
    } catch {
      // best-effort
    }
    ingressPf?.kill("SIGTERM");
    dragonflyPf?.kill("SIGTERM");
  });

  it("notification-svc Ingress route exists for /ws/stream", async () => {
    const out = await kubectl(
      "-n",
      "lw-idp",
      "get",
      "ing",
      "notification-svc",
      "-o",
      "jsonpath={.spec.rules[*].http.paths[*].path}={.spec.rules[*].http.paths[*].backend.service.name}",
    );
    expect(out).toContain("/ws/stream");
    expect(out).toContain("notification-svc");
  });

  it("WS connects with seeded session and receives welcome frame", async () => {
    const ws = openWsClient({
      url: `ws://127.0.0.1:${ingressPort}/ws/stream`,
      cookie: `lw-sid=${sid}`,
      headers: { Host: "portal.lw-idp.local" },
      handshakeTimeoutMs: 5_000,
    });
    try {
      await ws.opened;
      const welcome = await ws.waitFor<{ type: string; userId: string }>(
        (m): m is { type: string; userId: string } =>
          typeof m === "object" && (m as { type?: string }).type === "welcome",
        5_000,
      );
      expect(welcome.type).toBe("welcome");
      expect(welcome.userId).toBe(SEED_USER_ID);
    } finally {
      await ws.close();
    }
  }, 30_000);

  it("WS receives idp.catalog.service.created within 5s of POST /api/v1/services", async () => {
    const ws = openWsClient({
      url: `ws://127.0.0.1:${ingressPort}/ws/stream`,
      cookie: `lw-sid=${sid}`,
      headers: { Host: "portal.lw-idp.local" },
      handshakeTimeoutMs: 5_000,
    });
    try {
      await ws.opened;
      // Wait for welcome so the connection is registered before we trigger the event.
      await ws.waitFor<{ type: string }>(
        (m): m is { type: string } =>
          typeof m === "object" && (m as { type?: string }).type === "welcome",
        5_000,
      );

      const slug = `e2e-d1-${Date.now()}`;
      const res = await postJsonWithHost(
        `http://127.0.0.1:${ingressPort}/api/v1/services`,
        "portal.lw-idp.local",
        {
          slug,
          name: `E2E D1 ${slug}`,
          description: "WS fan-out e2e",
          type: "service",
          lifecycle: "experimental",
          ownerTeamId: SEED_TEAM_ID,
          tags: ["e2e", "d1"],
        },
        {
          cookie: `lw-sid=${sid}`,
          "idempotency-key": `e2e-d1-${slug}`,
        },
      );
      expect(res.status).toBe(201);

      const frame = await ws.waitFor<{
        type: string;
        entity: string;
        action: string;
        payload: { slug: string; ownerTeamId?: string };
      }>(
        (
          m,
        ): m is {
          type: string;
          entity: string;
          action: string;
          payload: { slug: string; ownerTeamId?: string };
        } => {
          if (typeof m !== "object" || m === null) {
            return false;
          }
          const v = m as { type?: string; payload?: { slug?: string } };
          return v.type === "idp.catalog.service.created" && v.payload?.slug === slug;
        },
        5_000,
      );
      expect(frame.type).toBe("idp.catalog.service.created");
      expect(frame.entity).toBe("service");
      expect(frame.action).toBe("created");
      expect(frame.payload.slug).toBe(slug);
    } finally {
      await ws.close();
    }
  }, 30_000);

  it("WS closes with 4401 when no cookie present", async () => {
    // openWsClient is convenient when we expect a successful handshake. For an
    // expected-close-after-handshake we drop down to the underlying ws lib so
    // we can capture the close code reliably.
    const ws = new WebSocket(`ws://127.0.0.1:${ingressPort}/ws/stream`, {
      headers: { Host: "portal.lw-idp.local" },
      handshakeTimeout: 5_000,
    });
    try {
      const closeInfo = await new Promise<{ code: number; reason: string }>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("ws close timeout")), 10_000);
        ws.on("close", (code, reason) => {
          clearTimeout(t);
          resolve({ code, reason: reason.toString("utf8") });
        });
        ws.on("error", () => {
          // Swallow — we only care about the close frame.
        });
      });
      expect(closeInfo.code).toBe(4401);
      expect(closeInfo.reason).toBe("unauthorized");
    } finally {
      if (ws.readyState !== WebSocket.CLOSED) {
        ws.terminate();
      }
    }
  }, 30_000);
});
