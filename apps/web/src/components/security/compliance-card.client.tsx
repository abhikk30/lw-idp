"use client";

import type { components } from "@lw-idp/contracts/gateway";
import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import type { UseQueryResult } from "@tanstack/react-query";
import { type ReactNode, useState } from "react";
import { SeverityBadge } from "./severity-badge.client.js";

type ComplianceData = components["schemas"]["SecurityComplianceResponse"];

export function ComplianceCard({
  compliance,
}: {
  compliance: UseQueryResult<ComplianceData, Error>;
}): ReactNode {
  const [openProfile, setOpenProfile] = useState<string | null>(null);
  const profiles = compliance.data?.profiles ?? [];
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">CIS Compliance</CardTitle>
      </CardHeader>
      <CardContent>
        {compliance.error ? (
          <p className="text-muted-foreground text-xs italic">Compliance data unavailable</p>
        ) : null}
        {profiles.length === 0 && !compliance.error ? (
          <p className="text-muted-foreground text-xs italic">No compliance reports yet</p>
        ) : null}
        <div className="flex flex-col gap-3">
          {profiles.map((p) => {
            const isOpen = openProfile === p.name;
            const failing = p.controls.filter((c) => c.status !== "PASS");
            return (
              <div key={p.name} className="text-sm">
                <button
                  type="button"
                  className="flex items-center gap-2 hover:underline"
                  onClick={() => setOpenProfile(isOpen ? null : p.name)}
                  aria-expanded={isOpen}
                >
                  <span className="font-mono text-xs">{p.name}</span>
                  <span>
                    {p.summary.passCount} pass / {p.summary.failCount} fail
                  </span>
                  <span className="text-muted-foreground text-xs">{isOpen ? "▼" : "▶"}</span>
                </button>
                {isOpen && failing.length === 0 ? (
                  <p className="text-muted-foreground mt-2 text-xs italic">All controls pass ✓</p>
                ) : null}
                {isOpen && failing.length > 0 ? (
                  <ul className="mt-2 space-y-1 text-xs">
                    {failing.map((c) => (
                      <li key={c.id} className="flex flex-wrap items-baseline gap-2">
                        <SeverityBadge severity={c.severity} />
                        <span className="font-mono">{c.id}</span>
                        <span>{c.name}</span>
                        <span className="text-muted-foreground">({c.status})</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

export type { ComplianceData };
