"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { useState } from "react";
import { apiClient } from "../../lib/api/client.js";
import { TraceDrawer } from "./trace-drawer.client.js";

export function TracesPanel({ serviceSlug }: { serviceSlug: string }): ReactNode {
  const [openTrace, setOpenTrace] = useState<string | null>(null);
  const { data, isLoading, error } = useQuery({
    queryKey: ["traces", serviceSlug],
    queryFn: async () => {
      const res = await apiClient().GET("/observability/traces", {
        params: { query: { service: serviceSlug, since: "1h", limit: 10 } },
      });
      if (res.error || !res.data) {
        throw new Error("Failed to load traces");
      }
      return res.data;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
          <CardTitle className="text-sm">Recent traces</CardTitle>
          <a
            className="text-muted-foreground text-xs underline"
            target="_blank"
            rel="noreferrer"
            href={`http://grafana.lw-idp.local/explore?orgId=1&left=${encodeURIComponent(
              JSON.stringify({ datasource: "tempo" }),
            )}`}
          >
            Open in Grafana ↗
          </a>
        </CardHeader>
        <CardContent className="p-0">
          <div className="max-h-[28rem] overflow-y-auto text-xs">
            {isLoading ? (
              <div className="text-muted-foreground p-3">Loading…</div>
            ) : error ? (
              <div className="text-destructive p-3">Traces unavailable</div>
            ) : (data?.traces ?? []).length === 0 ? (
              <div className="text-muted-foreground p-3 italic">No traces in the last 1h.</div>
            ) : (
              <ul>
                {(data?.traces ?? []).map((t) => (
                  <li key={t.trace_id}>
                    <button
                      type="button"
                      onClick={() => {
                        setOpenTrace(t.trace_id);
                      }}
                      className="hover:bg-accent block w-full border-b px-3 py-2 text-left"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[0.7rem]">{t.trace_id.slice(0, 11)}</span>
                        <span className="text-muted-foreground">{t.root_service}</span>
                        <span className="grow truncate">{t.root_operation}</span>
                        <span>{Math.round(t.duration_ms)}ms</span>
                        <span
                          className={t.status === "error" ? "text-destructive" : "text-green-600"}
                        >
                          {t.status}
                        </span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </CardContent>
      </Card>
      {openTrace ? (
        <TraceDrawer
          traceId={openTrace}
          onClose={() => {
            setOpenTrace(null);
          }}
        />
      ) : null}
    </>
  );
}
