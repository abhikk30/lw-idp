import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import type { K8sClient } from "../clients/k8s.js";

export interface SecurityPluginOptions {
  k8sClient: K8sClient;
  /**
   * Argo CD API base URL. The plugin reads `.spec.destination.namespace` from
   * the Argo CD Application CR named after the service slug to determine the
   * namespace to scope per-service Trivy reports. Mirrors the same pattern in
   * `apps/gateway-svc/src/http/observability.ts` — `targetNamespace` isn't on
   * the catalog row, so the App CR is the source of truth.
   */
  argocdApiUrl: string;
}

const TRIVY_API = "aquasecurity.github.io/v1alpha1";

interface ReportMeta {
  name?: string;
  namespace?: string;
  labels?: Record<string, string>;
}
interface SeveritySummary {
  criticalCount?: number;
  highCount?: number;
  mediumCount?: number;
  lowCount?: number;
  unknownCount?: number;
}
interface Check {
  checkID?: string;
  title?: string;
  severity?: string;
  messages?: string[];
}
interface Vulnerability {
  vulnerabilityID?: string;
  severity?: string;
  resource?: string;
  installedVersion?: string;
  fixedVersion?: string;
  primaryLink?: string;
}
interface VulnReport {
  metadata?: ReportMeta;
  report?: {
    summary?: SeveritySummary;
    updateTimestamp?: string;
    vulnerabilities?: Vulnerability[];
  };
}
interface ConfigAuditReport {
  metadata?: ReportMeta;
  report?: { summary?: SeveritySummary; checks?: Check[]; updateTimestamp?: string };
}
interface ExposedSecretReport {
  metadata?: ReportMeta;
  report?: {
    secrets?: {
      ruleID?: string;
      title?: string;
      severity?: string;
      match?: string;
      target?: string;
    }[];
  };
}
interface RbacAssessmentReport {
  metadata?: ReportMeta;
  report?: { checks?: Check[] };
}
interface ClusterComplianceReport {
  metadata?: ReportMeta;
  report?: {
    summary?: { passCount?: number; failCount?: number };
    controlChecks?: {
      id?: string;
      name?: string;
      severity?: string;
      checkResults?: { status?: string }[];
    }[];
  };
}

function sevKey(s?: string): string {
  return (s ?? "UNKNOWN").toUpperCase();
}

function workloadSlug(r: VulnReport | ConfigAuditReport | ExposedSecretReport): string | null {
  return r.metadata?.labels?.["trivy-operator.resource.name"] ?? null;
}

function isMissingCrd(err: unknown): boolean {
  return err instanceof Error && err.message.includes("404");
}

const SEVERITY_ORDER: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
  UNKNOWN: 4,
};

interface ServiceVuln {
  cve_id: string;
  severity: string;
  package: string;
  installed_version: string;
  fixed_version: string;
  primary_link: string;
}

function buildServiceReport(
  slug: string,
  ns: string,
  vulns: VulnReport[],
  configs: ConfigAuditReport[],
  secrets: ExposedSecretReport[],
) {
  const myVulns = vulns.filter((r) => workloadSlug(r) === slug);
  const myConfigs = configs.filter((r) => workloadSlug(r) === slug);
  const mySecrets = secrets.filter((r) => workloadSlug(r) === slug);

  const vulnSum = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
  const allVulns: ServiceVuln[] = [];
  let lastScan: string | null = null;
  for (const r of myVulns) {
    const s = r.report?.summary ?? {};
    vulnSum.critical += s.criticalCount ?? 0;
    vulnSum.high += s.highCount ?? 0;
    vulnSum.medium += s.mediumCount ?? 0;
    vulnSum.low += s.lowCount ?? 0;
    vulnSum.unknown += s.unknownCount ?? 0;
    const ts = r.report?.updateTimestamp;
    if (ts && (lastScan === null || ts > lastScan)) {
      lastScan = ts;
    }
    for (const v of r.report?.vulnerabilities ?? []) {
      allVulns.push({
        cve_id: v.vulnerabilityID ?? "",
        severity: sevKey(v.severity),
        package: v.resource ?? "",
        installed_version: v.installedVersion ?? "",
        fixed_version: v.fixedVersion ?? "",
        primary_link: v.primaryLink ?? "",
      });
    }
  }
  allVulns.sort((a, b) => (SEVERITY_ORDER[a.severity] ?? 99) - (SEVERITY_ORDER[b.severity] ?? 99));

  const configAudits = myConfigs.flatMap((r) =>
    (r.report?.checks ?? []).map((c) => ({
      check_id: c.checkID ?? "",
      title: c.title ?? "",
      severity: sevKey(c.severity),
      message: c.messages?.[0] ?? "",
    })),
  );

  const exposedSecrets = mySecrets.flatMap((r) =>
    (r.report?.secrets ?? []).map((s) => ({
      rule_id: s.ruleID ?? "",
      title: s.title ?? "",
      severity: sevKey(s.severity),
      match: s.match ?? "",
      target: s.target ?? "",
    })),
  );

  return {
    service: slug,
    namespace: ns,
    vulnerability_summary: vulnSum,
    vulnerabilities: allVulns.slice(0, 50),
    config_audits: configAudits,
    exposed_secrets: exposedSecrets,
    last_scan_at: lastScan,
  };
}

const securityPluginFn: FastifyPluginAsync<SecurityPluginOptions> = async (fastify, opts) => {
  fastify.get("/api/v1/security/cluster", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    let vulns: VulnReport[];
    let configs: ConfigAuditReport[];
    let secrets: ExposedSecretReport[];
    try {
      [vulns, configs, secrets] = await Promise.all([
        opts.k8sClient.listCustomResources({
          apiVersion: TRIVY_API,
          kind: "vulnerabilityreports",
        }) as Promise<VulnReport[]>,
        opts.k8sClient.listCustomResources({
          apiVersion: TRIVY_API,
          kind: "configauditreports",
        }) as Promise<ConfigAuditReport[]>,
        opts.k8sClient.listCustomResources({
          apiVersion: TRIVY_API,
          kind: "exposedsecretreports",
        }) as Promise<ExposedSecretReport[]>,
      ]);
    } catch (err) {
      if (isMissingCrd(err)) {
        return reply
          .code(503)
          .send({ code: "trivy_not_installed", message: "Trivy Operator CRDs not present" });
      }
      fastify.log.error({ err }, "trivy reports fetch failed");
      return reply.code(502).send({ code: "k8s_unreachable", message: "kube api unreachable" });
    }

    const vulnSum = { critical: 0, high: 0, medium: 0, low: 0, unknown: 0 };
    const perService = new Map<string, { critical: number; high: number }>();
    let lastScan: string | null = null;
    for (const r of vulns) {
      const s = r.report?.summary ?? {};
      vulnSum.critical += s.criticalCount ?? 0;
      vulnSum.high += s.highCount ?? 0;
      vulnSum.medium += s.mediumCount ?? 0;
      vulnSum.low += s.lowCount ?? 0;
      vulnSum.unknown += s.unknownCount ?? 0;
      const slug = workloadSlug(r);
      if (slug) {
        const prev = perService.get(slug) ?? { critical: 0, high: 0 };
        prev.critical += s.criticalCount ?? 0;
        prev.high += s.highCount ?? 0;
        perService.set(slug, prev);
      }
      const ts = r.report?.updateTimestamp;
      if (ts && (lastScan === null || ts > lastScan)) {
        lastScan = ts;
      }
    }
    const top = [...perService.entries()]
      .map(([slug, c]) => ({ slug, critical: c.critical, high: c.high }))
      .sort((a, b) => b.critical * 100 + b.high - (a.critical * 100 + a.high))
      .slice(0, 10);

    const configSum = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const r of configs) {
      const s = r.report?.summary ?? {};
      configSum.critical += s.criticalCount ?? 0;
      configSum.high += s.highCount ?? 0;
      configSum.medium += s.mediumCount ?? 0;
      configSum.low += s.lowCount ?? 0;
    }

    const exposedSecrets = secrets.flatMap((r) =>
      (r.report?.secrets ?? []).map((s) => ({
        rule_id: s.ruleID ?? "",
        title: s.title ?? "",
        severity: sevKey(s.severity),
        match: s.match ?? "",
        target: s.target ?? "",
        workload: r.metadata?.labels?.["trivy-operator.resource.name"] ?? r.metadata?.name ?? "?",
        namespace: r.metadata?.namespace ?? "?",
      })),
    );

    return reply.send({
      vulnerability_summary: vulnSum,
      config_audit_summary: configSum,
      exposed_secrets: { total: exposedSecrets.length, items: exposedSecrets.slice(0, 50) },
      scan_coverage: {
        workloads_scanned: vulns.length,
        workloads_total: vulns.length,
        last_scan_at: lastScan,
      },
      top_vulnerable_services: top,
    });
  });

  fastify.get("/api/v1/security/cluster/compliance", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    let reports: ClusterComplianceReport[];
    try {
      reports = (await opts.k8sClient.listCustomResources({
        apiVersion: TRIVY_API,
        kind: "clustercompliancereports",
      })) as ClusterComplianceReport[];
    } catch (err) {
      if (isMissingCrd(err)) {
        return reply
          .code(503)
          .send({ code: "trivy_not_installed", message: "Trivy Operator CRDs not present" });
      }
      fastify.log.error({ err }, "trivy compliance fetch failed");
      return reply.code(502).send({ code: "k8s_unreachable", message: "kube api unreachable" });
    }
    const profiles = reports.map((r) => ({
      name: r.metadata?.name ?? "?",
      summary: {
        passCount: r.report?.summary?.passCount ?? 0,
        failCount: r.report?.summary?.failCount ?? 0,
      },
      controls: (r.report?.controlChecks ?? []).map((c) => ({
        id: c.id ?? "",
        name: c.name ?? "",
        status: c.checkResults?.[0]?.status ?? "PASS",
        severity: sevKey(c.severity),
      })),
    }));
    return reply.send({ profiles });
  });

  fastify.get("/api/v1/security/cluster/rbac", async (req, reply) => {
    if (!req.session) {
      return reply.code(401).send({ code: "unauthorized", message: "auth required" });
    }
    let reports: RbacAssessmentReport[];
    try {
      reports = (await opts.k8sClient.listCustomResources({
        apiVersion: TRIVY_API,
        kind: "rbacassessmentreports",
      })) as RbacAssessmentReport[];
    } catch (err) {
      if (isMissingCrd(err)) {
        return reply
          .code(503)
          .send({ code: "trivy_not_installed", message: "Trivy Operator CRDs not present" });
      }
      fastify.log.error({ err }, "trivy rbac fetch failed");
      return reply.code(502).send({ code: "k8s_unreachable", message: "kube api unreachable" });
    }
    const findings = reports.flatMap((r) =>
      (r.report?.checks ?? [])
        .filter((c) => {
          const sev = sevKey(c.severity);
          return sev !== "LOW" && sev !== "UNKNOWN";
        })
        .map((c) => ({
          service_account: r.metadata?.name ?? "?",
          namespace: r.metadata?.namespace ?? "?",
          check_id: c.checkID ?? "",
          title: c.title ?? "",
          severity: sevKey(c.severity),
          message: c.messages?.[0] ?? "",
        })),
    );
    return reply.send({ findings });
  });

  // Resolve a service slug → its targetNamespace by reading the Argo CD
  // Application CR. Mirrors apps/gateway-svc/src/http/observability.ts —
  // kept locally to avoid cross-plugin coupling.
  async function resolveNamespace(slug: string, idToken: string): Promise<string | null> {
    const base = opts.argocdApiUrl.replace(/\/+$/, "");
    const url = `${base}/api/v1/applications/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${idToken}` } });
    if (res.status === 404) {
      return null;
    }
    if (!res.ok) {
      throw new Error(`argocd app lookup failed: ${res.status}`);
    }
    const json = (await res.json()) as { spec?: { destination?: { namespace?: string } } };
    return json.spec?.destination?.namespace ?? null;
  }

  fastify.get<{ Params: { slug: string } }>(
    "/api/v1/security/services/:slug",
    async (req, reply) => {
      if (!req.session) {
        return reply.code(401).send({ code: "unauthorized", message: "auth required" });
      }
      const slug = req.params.slug;
      if (!slug) {
        return reply.code(400).send({ code: "bad_request", message: "slug required" });
      }

      let ns: string | null;
      try {
        ns = await resolveNamespace(slug, req.session.idToken ?? "");
      } catch (err) {
        fastify.log.error({ err }, "argocd app lookup failed");
        return reply.code(502).send({ code: "argocd_unreachable", message: "argocd unreachable" });
      }
      if (ns === null) {
        return reply.code(404).send({ code: "not_found", message: "service not found in argocd" });
      }

      let vulns: VulnReport[];
      let configs: ConfigAuditReport[];
      let secrets: ExposedSecretReport[];
      try {
        [vulns, configs, secrets] = await Promise.all([
          opts.k8sClient.listCustomResources({
            apiVersion: TRIVY_API,
            kind: "vulnerabilityreports",
            namespace: ns,
          }) as Promise<VulnReport[]>,
          opts.k8sClient.listCustomResources({
            apiVersion: TRIVY_API,
            kind: "configauditreports",
            namespace: ns,
          }) as Promise<ConfigAuditReport[]>,
          opts.k8sClient.listCustomResources({
            apiVersion: TRIVY_API,
            kind: "exposedsecretreports",
            namespace: ns,
          }) as Promise<ExposedSecretReport[]>,
        ]);
      } catch (err) {
        if (isMissingCrd(err)) {
          return reply
            .code(503)
            .send({ code: "trivy_not_installed", message: "Trivy Operator CRDs not present" });
        }
        fastify.log.error({ err }, "trivy reports fetch failed");
        return reply.code(502).send({ code: "k8s_unreachable", message: "kube api unreachable" });
      }

      return reply.send(buildServiceReport(slug, ns, vulns, configs, secrets));
    },
  );
};

export const securityPlugin = fp(securityPluginFn, { name: "lw-idp-security" });
