import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-node";
import { CatalogService, Lifecycle, ServiceType } from "@lw-idp/contracts/catalog/v1";
import { ClusterService, Environment, Provider } from "@lw-idp/contracts/cluster/v1";
import { execa } from "execa";
import {
  AckPolicy,
  DeliverPolicy,
  JSONCodec,
  type NatsConnection,
  connect as natsConnect,
} from "nats";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

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
