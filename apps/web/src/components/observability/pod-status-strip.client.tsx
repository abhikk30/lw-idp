"use client";

import { Badge } from "@lw-idp/ui/components/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api/client.js";

export function PodStatusStrip({ serviceSlug }: { serviceSlug: string }): ReactNode {
  const { data, isLoading, error } = useQuery({
    queryKey: ["pods", serviceSlug],
    queryFn: async () => {
      const res = await apiClient().GET("/observability/pods", {
        params: { query: { service: serviceSlug } },
      });
      if (res.error || !res.data) {
        throw new Error("Failed to load pods");
      }
      return res.data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          Pods
          {data ? (
            <Badge variant="secondary">
              {data.pods.filter((p) => p.ready).length} / {data.pods.length} ready
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="text-muted-foreground text-sm">Loading…</div>
        ) : error ? (
          <div className="text-destructive text-sm">Pod status unavailable</div>
        ) : (data?.pods ?? []).length === 0 ? (
          <div className="text-muted-foreground text-sm italic">
            No pods running. The service may not be deployed yet, or it doesn't carry the
            <code className="mx-1">app.kubernetes.io/instance</code>
            label that scopes this query.
          </div>
        ) : (
          <ul className="space-y-1 font-mono text-xs">
            {(data?.pods ?? []).map((p) => (
              <li key={p.name} className="flex flex-wrap items-center gap-2">
                <Badge variant={p.ready ? "default" : "destructive"}>
                  {p.ready ? "ready" : p.phase}
                </Badge>
                <span className="truncate">{p.name}</span>
                <span className="text-muted-foreground">{ageOf(p.started_at)} old</span>
                <span className="text-muted-foreground">
                  {p.restart_count} restart{p.restart_count === 1 ? "" : "s"}
                </span>
                <span className="text-muted-foreground">{p.node ?? "?"}</span>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

function ageOf(iso: string | null | undefined): string {
  if (!iso) {
    return "?";
  }
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 60) {
    return `${m}m`;
  }
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
