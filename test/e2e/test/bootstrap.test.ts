import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { execa } from "execa";
import { describe, expect, it } from "vitest";

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
