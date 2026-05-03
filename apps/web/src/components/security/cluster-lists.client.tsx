"use client";

import type { components } from "@lw-idp/contracts/gateway";
import type { ReactNode } from "react";
import { SeverityBadge } from "./severity-badge.client.js";

type RbacFinding = components["schemas"]["RbacFinding"];
type ExposedSecretsBlock = components["schemas"]["ExposedSecretsBlock"];

export function SeverityBar({
  counts,
  includeUnknown = false,
}: {
  counts: { critical: number; high: number; medium: number; low: number; unknown?: number };
  includeUnknown?: boolean;
}): ReactNode {
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span>
        <SeverityBadge severity="CRITICAL" /> {counts.critical}
      </span>
      <span>
        <SeverityBadge severity="HIGH" /> {counts.high}
      </span>
      <span>
        <SeverityBadge severity="MEDIUM" /> {counts.medium}
      </span>
      <span>
        <SeverityBadge severity="LOW" /> {counts.low}
      </span>
      {includeUnknown && counts.unknown !== undefined && counts.unknown > 0 ? (
        <span>
          <SeverityBadge severity="UNKNOWN" /> {counts.unknown}
        </span>
      ) : null}
    </div>
  );
}

export function RbacFindingsList({
  findings,
  hasError,
}: {
  findings: RbacFinding[];
  hasError: boolean;
}): ReactNode {
  if (hasError) {
    return <p className="text-muted-foreground text-xs italic">RBAC findings unavailable</p>;
  }
  if (findings.length === 0) {
    return <p className="text-muted-foreground text-xs italic">No high-severity RBAC issues ✓</p>;
  }
  return (
    <ul className="space-y-1 text-xs">
      {findings.map((f, i) => (
        <li
          key={`${f.service_account}-${f.check_id}-${i}`}
          className="flex flex-wrap items-baseline gap-2"
        >
          <SeverityBadge severity={f.severity} />
          <span className="font-mono">
            {f.namespace}/{f.service_account}
          </span>
          <span>{f.title}</span>
          <span className="text-muted-foreground">({f.check_id})</span>
        </li>
      ))}
    </ul>
  );
}

export function ExposedSecretsList({
  secrets,
}: {
  secrets: ExposedSecretsBlock | undefined;
}): ReactNode {
  if (!secrets || secrets.total === 0) {
    return <p className="text-muted-foreground text-xs italic">None detected ✓</p>;
  }
  return (
    <ul className="space-y-1 font-mono text-xs">
      {secrets.items.map((s, i) => (
        <li key={`${s.rule_id}-${i}`} className="flex flex-wrap items-center gap-2">
          <SeverityBadge severity={s.severity} />
          <span>{s.title}</span>
          <span className="text-muted-foreground">
            {s.namespace}/{s.workload}
          </span>
        </li>
      ))}
    </ul>
  );
}
