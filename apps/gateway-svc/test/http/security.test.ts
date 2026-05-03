import type { SessionRecord, SessionStore, SessionStoreSetOptions } from "@lw-idp/auth";
import { type LwIdpServer, buildServer } from "@lw-idp/service-kit";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { K8sClient } from "../../src/clients/k8s.js";
import { securityPlugin } from "../../src/http/security.js";
import { sessionPlugin } from "../../src/middleware/session.js";

interface FakeK8s extends K8sClient {
  setStubs(stubs: Map<string, unknown[] | "missing">): void;
}

function fakeK8sClient(): FakeK8s {
  let current: Map<string, unknown[] | "missing"> = new Map();
  return {
    setStubs(stubs) {
      current = stubs;
    },
    async listPods() {
      throw new Error("listPods not used in security tests");
    },
    async listCustomResources({ kind }) {
      const r = current.get(kind);
      if (r === undefined || r === "missing") {
        throw new Error(`k8s list ${kind} failed: 404`);
      }
      return r as Record<string, unknown>[];
    },
  };
}

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

const SESSION_COOKIE = { cookie: "lw-sid=sess_sec_ok" };

describe("gateway /api/v1/security/cluster*", () => {
  let gateway: LwIdpServer;
  let gatewayUrl: string;
  let k8s: FakeK8s;

  beforeAll(async () => {
    k8s = fakeK8sClient();
    const sessionStore = memorySession();
    await sessionStore.set(
      "sess_sec_ok",
      {
        userId: "u_sec_test",
        email: "sec@test.com",
        displayName: "Sec Tester",
        teams: [],
        idToken: "fake.jwt.token",
        createdAt: new Date().toISOString(),
      },
      { ttlSeconds: 3600 },
    );

    gateway = await buildServer({
      name: "gateway-svc",
      port: 0,
      register: async (fastify) => {
        await fastify.register(sessionPlugin, { store: sessionStore });
        await fastify.register(securityPlugin, { k8sClient: k8s });
      },
    });
    const addr = await gateway.listen();
    gatewayUrl = (typeof addr === "string" ? addr : `http://127.0.0.1:${addr}`).replace(
      "0.0.0.0",
      "127.0.0.1",
    );
  });

  afterAll(async () => {
    await gateway?.close();
  });

  beforeEach(() => {
    // Default: every CRD kind missing → 503. Each test installs the kinds it needs.
    k8s.setStubs(new Map());
  });

  // ---------- /api/v1/security/cluster ----------

  describe("GET /api/v1/security/cluster", () => {
    it("returns 401 without a session cookie", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster`);
      expect(res.status).toBe(401);
    });

    it("returns 200 with summed vulnerability + config + secret stats (happy path)", async () => {
      const vulns = [
        {
          metadata: {
            name: "deployment-gateway-svc",
            namespace: "lw-idp",
            labels: { "trivy-operator.resource.name": "gateway-svc" },
          },
          report: {
            summary: {
              criticalCount: 3,
              highCount: 12,
              mediumCount: 41,
              lowCount: 7,
              unknownCount: 0,
            },
            updateTimestamp: "2026-05-04T01:23:00Z",
          },
        },
        {
          metadata: {
            name: "deployment-catalog-svc",
            namespace: "lw-idp",
            labels: { "trivy-operator.resource.name": "catalog-svc" },
          },
          report: {
            summary: {
              criticalCount: 3,
              highCount: 8,
              mediumCount: 10,
              lowCount: 2,
              unknownCount: 1,
            },
            updateTimestamp: "2026-05-04T02:00:00Z",
          },
        },
      ];
      const configs = [
        {
          metadata: { name: "deployment-gateway-svc", namespace: "lw-idp" },
          report: {
            summary: { criticalCount: 1, highCount: 4, mediumCount: 2, lowCount: 0 },
          },
        },
      ];
      const secrets = [
        {
          metadata: {
            name: "deployment-gateway-svc",
            namespace: "lw-idp",
            labels: { "trivy-operator.resource.name": "gateway-svc" },
          },
          report: {
            secrets: [
              {
                ruleID: "aws-access-key",
                title: "AWS Access Key",
                severity: "CRITICAL",
                match: "AKIA...",
                target: "config.yaml",
              },
            ],
          },
        },
      ];
      k8s.setStubs(
        new Map<string, unknown[]>([
          ["vulnerabilityreports", vulns],
          ["configauditreports", configs],
          ["exposedsecretreports", secrets],
        ]),
      );

      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster`, { headers: SESSION_COOKIE });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        vulnerability_summary: {
          critical: number;
          high: number;
          medium: number;
          low: number;
          unknown: number;
        };
        config_audit_summary: { critical: number; high: number; medium: number; low: number };
        exposed_secrets: { total: number; items: { rule_id: string }[] };
        scan_coverage: { workloads_scanned: number; last_scan_at: string | null };
      };
      expect(body.vulnerability_summary).toEqual({
        critical: 6,
        high: 20,
        medium: 51,
        low: 9,
        unknown: 1,
      });
      expect(body.config_audit_summary).toEqual({
        critical: 1,
        high: 4,
        medium: 2,
        low: 0,
      });
      expect(body.exposed_secrets.total).toBe(1);
      expect(body.exposed_secrets.items[0]?.rule_id).toBe("aws-access-key");
      expect(body.scan_coverage.workloads_scanned).toBe(2);
      // lastScan is the max of the two updateTimestamps.
      expect(body.scan_coverage.last_scan_at).toBe("2026-05-04T02:00:00Z");
    });

    it("returns all-zero summaries with empty arrays", async () => {
      k8s.setStubs(
        new Map<string, unknown[]>([
          ["vulnerabilityreports", []],
          ["configauditreports", []],
          ["exposedsecretreports", []],
        ]),
      );
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster`, { headers: SESSION_COOKIE });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        vulnerability_summary: { critical: number };
        config_audit_summary: { critical: number };
        exposed_secrets: { total: number };
        top_vulnerable_services: unknown[];
        scan_coverage: { workloads_scanned: number; last_scan_at: string | null };
      };
      expect(body.vulnerability_summary.critical).toBe(0);
      expect(body.config_audit_summary.critical).toBe(0);
      expect(body.exposed_secrets.total).toBe(0);
      expect(body.top_vulnerable_services).toEqual([]);
      expect(body.scan_coverage.workloads_scanned).toBe(0);
      expect(body.scan_coverage.last_scan_at).toBeNull();
    });

    it("returns 503 trivy_not_installed when CRDs are missing (404)", async () => {
      // Default beforeEach left stubs empty → listCustomResources throws "404".
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster`, { headers: SESSION_COOKIE });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("trivy_not_installed");
    });

    it("ranks top_vulnerable_services by critical*100+high desc and slices to 10", async () => {
      // 12 services with deterministic counts. The ranking key is
      // critical*100 + high. We give services indices 0..11 the counts
      // (critical=12-i, high=0). That guarantees a clean descending order
      // and that the bottom 2 (slugs svc-10, svc-11) get sliced off.
      const vulns = Array.from({ length: 12 }, (_, i) => ({
        metadata: {
          name: `deployment-svc-${i}`,
          namespace: "lw-idp",
          labels: { "trivy-operator.resource.name": `svc-${i}` },
        },
        report: {
          summary: {
            criticalCount: 12 - i,
            highCount: 0,
            mediumCount: 0,
            lowCount: 0,
            unknownCount: 0,
          },
          updateTimestamp: "2026-05-04T00:00:00Z",
        },
      }));
      k8s.setStubs(
        new Map<string, unknown[]>([
          ["vulnerabilityreports", vulns],
          ["configauditreports", []],
          ["exposedsecretreports", []],
        ]),
      );
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster`, { headers: SESSION_COOKIE });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        top_vulnerable_services: { slug: string; critical: number; high: number }[];
      };
      expect(body.top_vulnerable_services).toHaveLength(10);
      expect(body.top_vulnerable_services[0]?.slug).toBe("svc-0");
      expect(body.top_vulnerable_services[0]?.critical).toBe(12);
      expect(body.top_vulnerable_services[9]?.slug).toBe("svc-9");
      const slugs = body.top_vulnerable_services.map((s) => s.slug);
      expect(slugs).not.toContain("svc-10");
      expect(slugs).not.toContain("svc-11");
    });
  });

  // ---------- /api/v1/security/cluster/compliance ----------

  describe("GET /api/v1/security/cluster/compliance", () => {
    it("returns 401 without a session cookie", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/compliance`);
      expect(res.status).toBe(401);
    });

    it("returns 200 with profiles array", async () => {
      const reports = [
        {
          metadata: { name: "cis" },
          report: {
            summary: { passCount: 42, failCount: 7 },
            controlChecks: [
              {
                id: "1.1.1",
                name: "Ensure pod security",
                severity: "HIGH",
                checkResults: [{ status: "FAIL" }],
              },
              {
                id: "1.1.2",
                name: "Ensure RBAC",
                severity: "MEDIUM",
                // No checkResults → handler defaults status to "PASS".
              },
            ],
          },
        },
      ];
      k8s.setStubs(new Map<string, unknown[]>([["clustercompliancereports", reports]]));
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/compliance`, {
        headers: SESSION_COOKIE,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        profiles: {
          name: string;
          summary: { passCount: number; failCount: number };
          controls: { id: string; status: string; severity: string }[];
        }[];
      };
      expect(body.profiles).toHaveLength(1);
      expect(body.profiles[0]?.name).toBe("cis");
      expect(body.profiles[0]?.summary).toEqual({ passCount: 42, failCount: 7 });
      expect(body.profiles[0]?.controls).toHaveLength(2);
      expect(body.profiles[0]?.controls[0]?.status).toBe("FAIL");
      expect(body.profiles[0]?.controls[1]?.status).toBe("PASS");
      expect(body.profiles[0]?.controls[0]?.severity).toBe("HIGH");
    });

    it("returns 503 trivy_not_installed when CRD missing (404)", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/compliance`, {
        headers: SESSION_COOKIE,
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("trivy_not_installed");
    });
  });

  // ---------- /api/v1/security/cluster/rbac ----------

  describe("GET /api/v1/security/cluster/rbac", () => {
    it("returns 401 without a session cookie", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/rbac`);
      expect(res.status).toBe(401);
    });

    it("returns 200 with flattened findings, filtering LOW + UNKNOWN", async () => {
      const reports = [
        {
          metadata: { name: "default", namespace: "lw-idp" },
          report: {
            checks: [
              {
                checkID: "AVD-KSV-001",
                title: "Excessive permissions",
                severity: "HIGH",
                messages: ["sa allows wildcard"],
              },
              {
                checkID: "AVD-KSV-002",
                title: "Cluster admin bound",
                severity: "CRITICAL",
                messages: ["bound cluster-admin"],
              },
              {
                checkID: "AVD-KSV-003",
                title: "Minor read perm",
                severity: "LOW",
                messages: ["should be filtered out"],
              },
              {
                checkID: "AVD-KSV-004",
                title: "Unknown severity",
                // missing severity → UNKNOWN → filtered out
                messages: ["should be filtered out"],
              },
            ],
          },
        },
      ];
      k8s.setStubs(new Map<string, unknown[]>([["rbacassessmentreports", reports]]));
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/rbac`, {
        headers: SESSION_COOKIE,
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        findings: {
          service_account: string;
          namespace: string;
          check_id: string;
          severity: string;
        }[];
      };
      expect(body.findings).toHaveLength(2);
      const ids = body.findings.map((f) => f.check_id);
      expect(ids).toContain("AVD-KSV-001");
      expect(ids).toContain("AVD-KSV-002");
      expect(ids).not.toContain("AVD-KSV-003");
      expect(ids).not.toContain("AVD-KSV-004");
      expect(body.findings[0]?.service_account).toBe("default");
      expect(body.findings[0]?.namespace).toBe("lw-idp");
    });

    it("returns 503 trivy_not_installed when CRD missing (404)", async () => {
      const res = await fetch(`${gatewayUrl}/api/v1/security/cluster/rbac`, {
        headers: SESSION_COOKIE,
      });
      expect(res.status).toBe(503);
      const body = (await res.json()) as { code: string };
      expect(body.code).toBe("trivy_not_installed");
    });
  });
});
