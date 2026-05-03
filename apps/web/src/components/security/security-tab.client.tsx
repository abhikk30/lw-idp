"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api/client.js";
import { SeverityBadge } from "./severity-badge.client.js";

export function SecurityTab({ serviceSlug }: { serviceSlug: string }): ReactNode {
  const { data, isLoading, error } = useQuery({
    queryKey: ["security-service", serviceSlug],
    queryFn: async () => {
      const res = await apiClient().GET("/security/services/{slug}", {
        params: { path: { slug: serviceSlug } },
      });
      if (res.error || !res.data) {
        throw new Error("Failed to load security data");
      }
      return res.data;
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  if (isLoading) {
    return <div className="text-muted-foreground p-3 text-sm">Loading…</div>;
  }
  if (error) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-destructive text-sm font-medium">Security data unavailable</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Trivy Operator may not be installed yet, or its first scan is still in progress (initial
            scans take ~10 min after deploy). See <code>infra/trivy/values.yaml</code>.
          </p>
        </CardContent>
      </Card>
    );
  }

  const v = data?.vulnerability_summary ?? {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    unknown: 0,
  };
  const lastScan = data?.last_scan_at;
  // Vuln scan is pending (Trivy hasn't pulled the image yet) when there's
  // no last_scan_at AND every severity bucket is zero. Config audits run
  // independently from manifest data, so they may already be present even
  // when the vuln side hasn't started — distinguish to avoid showing
  // "Critical 0 / High 0" as if the image had been verified clean.
  const vulnScanPending = !lastScan && v.critical + v.high + v.medium + v.low + v.unknown === 0;
  const noReports =
    !data?.last_scan_at &&
    (data?.vulnerabilities ?? []).length === 0 &&
    (data?.config_audits ?? []).length === 0 &&
    (data?.exposed_secrets ?? []).length === 0;

  if (noReports) {
    return (
      <Card>
        <CardContent className="p-4">
          <p className="text-sm font-medium">First scan in progress</p>
          <p className="text-muted-foreground mt-1 text-xs">
            Trivy hasn't scanned this workload yet. Reports usually land within ~10 min after a new
            deploy. Refresh in a moment.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Vulnerabilities</CardTitle>
        </CardHeader>
        <CardContent>
          {vulnScanPending ? (
            <p className="text-muted-foreground text-xs italic">
              Vulnerability scan pending. Trivy hasn't pulled this image yet — initial scans are
              queued one image at a time. Config audits below are unaffected.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                <SeverityBadge severity="CRITICAL" /> {v.critical}
              </span>
              <span>
                <SeverityBadge severity="HIGH" /> {v.high}
              </span>
              <span>
                <SeverityBadge severity="MEDIUM" /> {v.medium}
              </span>
              <span>
                <SeverityBadge severity="LOW" /> {v.low}
              </span>
              {v.unknown > 0 ? (
                <span>
                  <SeverityBadge severity="UNKNOWN" /> {v.unknown}
                </span>
              ) : null}
            </div>
          )}
          {lastScan ? (
            <p className="text-muted-foreground mt-2 text-xs">
              Last scan: {new Date(lastScan).toLocaleString()} · namespace {data?.namespace}
            </p>
          ) : null}
          {(data?.vulnerabilities ?? []).length > 0 ? (
            <ul className="mt-3 max-h-96 overflow-y-auto font-mono text-xs">
              {(data?.vulnerabilities ?? []).map((cve, i) => (
                <li
                  key={`${cve.cve_id}-${i}`}
                  className="flex flex-wrap items-center gap-2 border-b py-1"
                >
                  <SeverityBadge severity={cve.severity} />
                  {cve.primary_link ? (
                    <a
                      className="text-primary underline"
                      href={cve.primary_link}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {cve.cve_id}
                    </a>
                  ) : (
                    <span>{cve.cve_id}</span>
                  )}
                  <span className="text-muted-foreground">{cve.package}</span>
                  <span>
                    {cve.installed_version} → {cve.fixed_version || "(no fix)"}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Config audits</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.config_audits ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs italic">No misconfigurations detected.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {(data?.config_audits ?? []).map((c, i) => (
                <li key={`${c.check_id}-${i}`} className="flex flex-wrap items-baseline gap-2">
                  <SeverityBadge severity={c.severity} />
                  <span className="font-medium">{c.title}</span>
                  <span className="text-muted-foreground">({c.check_id})</span>
                  {c.message ? <span className="text-muted-foreground">— {c.message}</span> : null}
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Exposed secrets</CardTitle>
        </CardHeader>
        <CardContent>
          {(data?.exposed_secrets ?? []).length === 0 ? (
            <p className="text-muted-foreground text-xs italic">No secrets detected ✓</p>
          ) : (
            <ul className="space-y-1 font-mono text-xs">
              {(data?.exposed_secrets ?? []).map((s, i) => (
                <li key={`${s.rule_id}-${i}`} className="flex flex-wrap items-center gap-2">
                  <SeverityBadge severity={s.severity} />
                  <span>{s.title}</span>
                  <span className="text-muted-foreground">{s.target}</span>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
