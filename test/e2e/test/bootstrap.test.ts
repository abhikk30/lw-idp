import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
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
