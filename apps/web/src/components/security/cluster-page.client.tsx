"use client";

import type { components } from "@lw-idp/contracts/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api/client.js";
import { ExposedSecretsList, RbacFindingsList, SeverityBar } from "./cluster-lists.client.js";
import { ComplianceCard, type ComplianceData } from "./compliance-card.client.js";
import { SeverityBadge } from "./severity-badge.client.js";

type ClusterData = components["schemas"]["SecurityClusterResponse"];
type RbacData = components["schemas"]["SecurityRbacResponse"];

const REFRESH_MS = 5 * 60_000;

function useSecurityQuery<T>(
  key: string,
  fetcher: () => Promise<T>,
): ReturnType<typeof useQuery<T, Error>> {
  return useQuery<T, Error>({
    queryKey: [key],
    queryFn: fetcher,
    refetchInterval: REFRESH_MS,
    retry: 1,
  });
}

export function SecurityClusterPage(): ReactNode {
  const cluster = useSecurityQuery<ClusterData>("security-cluster", async () => {
    const res = await apiClient().GET("/security/cluster", {});
    if (res.error || !res.data) {
      const status = res.response?.status;
      throw new Error(`cluster query failed${status ? ` (${status})` : ""}`);
    }
    return res.data;
  });

  const compliance = useSecurityQuery<ComplianceData>("security-compliance", async () => {
    const res = await apiClient().GET("/security/cluster/compliance", {});
    if (res.error || !res.data) {
      throw new Error("compliance query failed");
    }
    return res.data;
  });

  const rbac = useSecurityQuery<RbacData>("security-rbac", async () => {
    const res = await apiClient().GET("/security/cluster/rbac", {});
    if (res.error || !res.data) {
      throw new Error("rbac query failed");
    }
    return res.data;
  });

  const services = useQuery({
    queryKey: ["services-list-for-security"],
    queryFn: async () => {
      const res = await apiClient().GET("/services", { params: { query: { limit: 100 } } });
      if (res.error || !res.data) {
        throw new Error("services list failed");
      }
      return res.data;
    },
    staleTime: 60_000,
  });

  const slugToId = new Map<string, string>();
  for (const s of services.data?.items ?? []) {
    slugToId.set(s.slug, s.id);
  }

  const clusterErrIsTrivy = isTrivyNotInstalled(cluster.error);
  const allZero =
    cluster.data &&
    cluster.data.vulnerability_summary.critical === 0 &&
    cluster.data.vulnerability_summary.high === 0 &&
    cluster.data.vulnerability_summary.medium === 0 &&
    cluster.data.vulnerability_summary.low === 0 &&
    cluster.data.vulnerability_summary.unknown === 0 &&
    cluster.data.scan_coverage.last_scan_at === null;

  if (clusterErrIsTrivy) {
    return (
      <div className="flex max-w-6xl flex-col gap-4">
        <Header coverage={null} />
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">Trivy Operator not running</p>
            <p className="text-muted-foreground mt-2 text-xs">
              Install it via <code>infra/trivy/values.yaml</code> and re-run{" "}
              <code>helmfile sync</code>. Reports usually appear within ~10 min after deploy.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (allZero) {
    return (
      <div className="flex max-w-6xl flex-col gap-4">
        <Header coverage={cluster.data?.scan_coverage ?? null} />
        <Card>
          <CardContent className="p-6">
            <p className="text-sm font-medium">First scan in progress</p>
            <p className="text-muted-foreground mt-2 text-xs">
              Trivy hasn't produced any reports yet. Refresh in ~10 min.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const v = cluster.data?.vulnerability_summary;
  const ca = cluster.data?.config_audit_summary;
  const top = (cluster.data?.top_vulnerable_services ?? []).slice(0, 10);
  const findings = rbac.data?.findings ?? [];
  const secrets = cluster.data?.exposed_secrets;

  return (
    <div className="flex max-w-6xl flex-col gap-4">
      <Header coverage={cluster.data?.scan_coverage ?? null} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Vulnerabilities</CardTitle>
        </CardHeader>
        <CardContent>
          {cluster.error ? (
            <p className="text-muted-foreground text-xs italic">Vulnerability data unavailable</p>
          ) : null}
          {v ? <SeverityBar counts={v} includeUnknown /> : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Top vulnerable services</CardTitle>
        </CardHeader>
        <CardContent>
          {top.length === 0 ? (
            <p className="text-muted-foreground text-xs italic">
              No services with vulnerabilities ✓
            </p>
          ) : (
            <ul className="space-y-1 text-sm">
              {top.map((s) => {
                const id = slugToId.get(s.slug);
                const label = (
                  <span className="flex flex-wrap items-center gap-2 font-mono">
                    <span>{s.slug}</span>
                    <SeverityBadge severity="CRITICAL" />
                    <span>{s.critical}</span>
                    <SeverityBadge severity="HIGH" />
                    <span>{s.high}</span>
                  </span>
                );
                return (
                  <li key={s.slug}>
                    {id ? (
                      <Link
                        className="text-primary hover:underline"
                        href={`/services/${id}/security`}
                      >
                        {label}
                      </Link>
                    ) : (
                      label
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Config audits</CardTitle>
        </CardHeader>
        <CardContent>
          {cluster.error ? (
            <p className="text-muted-foreground text-xs italic">Config audit data unavailable</p>
          ) : null}
          {ca ? <SeverityBar counts={ca} /> : null}
        </CardContent>
      </Card>

      <ComplianceCard compliance={compliance} />

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">RBAC findings</CardTitle>
        </CardHeader>
        <CardContent>
          <RbacFindingsList findings={findings} hasError={Boolean(rbac.error)} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Exposed secrets</CardTitle>
        </CardHeader>
        <CardContent>
          <ExposedSecretsList secrets={secrets} />
        </CardContent>
      </Card>
    </div>
  );
}

function Header({
  coverage,
}: {
  coverage: ClusterData["scan_coverage"] | null;
}): ReactNode {
  return (
    <div>
      <h1 className="text-2xl font-bold tracking-tight">Security</h1>
      {coverage ? (
        <p className="text-muted-foreground mt-1 text-sm">
          Coverage: {coverage.workloads_scanned} / {coverage.workloads_total} workloads scanned
          {coverage.last_scan_at ? <> · last scan {timeAgo(coverage.last_scan_at)}</> : null}
        </p>
      ) : null}
    </div>
  );
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) {
    return "just now";
  }
  const m = Math.floor(ms / 60_000);
  if (m < 60) {
    return `${m} min ago`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m ago`;
}

function isTrivyNotInstalled(err: unknown): boolean {
  if (!err) {
    return false;
  }
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes("503") || msg.toLowerCase().includes("trivy");
}
