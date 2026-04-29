"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";
import { apiClient } from "../../lib/api/client.js";

type Panel = "req_rate" | "error_rate" | "p95_latency";

export function MetricsSparkline({
  serviceSlug,
  panel,
  label,
}: {
  serviceSlug: string;
  panel: Panel;
  label: string;
}): ReactNode {
  const { data, isLoading, error } = useQuery({
    queryKey: ["metrics", serviceSlug, panel],
    queryFn: async () => {
      const res = await apiClient().GET("/observability/metrics", {
        params: { query: { service: serviceSlug, panel } },
      });
      if (res.error || !res.data) {
        throw new Error("Failed to load metrics");
      }
      return res.data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  const points = (data?.points ?? []).map((p) => ({ ts: p.ts, value: p.value }));
  const latest = points.length > 0 ? points[points.length - 1].value : null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm">{label}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-20">
          {isLoading ? (
            <div className="text-muted-foreground text-xs">Loading…</div>
          ) : error ? (
            <div className="text-destructive text-xs">Metric unavailable</div>
          ) : points.length === 0 ? (
            <div className="text-muted-foreground text-xs italic">No data in the last 1h</div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={points} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke="hsl(var(--primary))"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
                <Tooltip
                  formatter={(v) => formatValue(panel, Number(v))}
                  labelFormatter={(l) => new Date(String(l)).toLocaleTimeString()}
                  contentStyle={{ fontSize: "0.75rem", padding: "0.25rem 0.5rem" }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>
        <div className="text-muted-foreground mt-1 text-xs">
          Latest: {latest === null ? "—" : formatValue(panel, latest)}
        </div>
      </CardContent>
    </Card>
  );
}

function formatValue(panel: Panel, v: number): string {
  if (panel === "req_rate") {
    return `${v.toFixed(1)} req/s`;
  }
  if (panel === "error_rate") {
    return `${(v * 100).toFixed(2)}%`;
  }
  return `${v.toFixed(0)} ms`;
}
