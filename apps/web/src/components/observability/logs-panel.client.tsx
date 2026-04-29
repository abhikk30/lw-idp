"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@lw-idp/ui/components/card";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api/client.js";

export function LogsPanel({ serviceSlug }: { serviceSlug: string }): ReactNode {
  const sp = useSearchParams();
  const router = useRouter();
  const traceFilter = sp.get("trace_id");

  const { data, isLoading, error } = useQuery({
    queryKey: ["logs", serviceSlug, traceFilter],
    queryFn: async () => {
      const query: { service: string; since: string; limit: number; trace_id?: string } = {
        service: serviceSlug,
        since: "1h",
        limit: 200,
      };
      if (traceFilter) {
        query.trace_id = traceFilter;
      }
      const res = await apiClient().GET("/observability/logs", { params: { query } });
      if (res.error || !res.data) {
        throw new Error("Failed to load logs");
      }
      return res.data;
    },
    refetchInterval: 15_000,
    retry: 1,
  });

  function setTraceFilter(traceId: string | null): void {
    const np = new URLSearchParams(sp.toString());
    if (traceId === null) {
      np.delete("trace_id");
    } else {
      np.set("trace_id", traceId);
    }
    router.replace(`?${np.toString()}`);
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 pb-2">
        <CardTitle className="text-sm">
          Logs (last 1h{traceFilter ? `, trace ${traceFilter.slice(0, 7)}` : ""})
          {traceFilter ? (
            <button
              type="button"
              onClick={() => setTraceFilter(null)}
              className="ml-2 text-xs underline"
            >
              clear
            </button>
          ) : null}
        </CardTitle>
        <a
          className="text-muted-foreground text-xs underline"
          target="_blank"
          rel="noreferrer"
          href={grafanaLogsUrl(traceFilter)}
        >
          Open in Grafana ↗
        </a>
      </CardHeader>
      <CardContent className="p-0">
        <div className="max-h-[28rem] overflow-y-auto font-mono text-xs">
          {isLoading ? (
            <div className="text-muted-foreground p-3">Loading…</div>
          ) : error ? (
            <div className="text-destructive p-3">Logs unavailable</div>
          ) : (data?.lines ?? []).length === 0 ? (
            <div className="text-muted-foreground p-3 italic">
              No logs in the last 1h{traceFilter ? " for this trace" : ""}.
            </div>
          ) : (
            <ul>
              {(data?.lines ?? []).map((l, i) => (
                <li key={`${l.ts}-${i}`} className="flex flex-wrap gap-2 border-b px-3 py-1.5">
                  <span className="text-muted-foreground">
                    {new Date(l.ts).toLocaleTimeString()}
                  </span>
                  <span className={levelClass(l.level)}>{(l.level ?? "—").toUpperCase()}</span>
                  {l.trace_id ? (
                    <button
                      type="button"
                      onClick={() => {
                        setTraceFilter(l.trace_id ?? null);
                      }}
                      className="text-primary underline"
                    >
                      trace={l.trace_id.slice(0, 7)}
                    </button>
                  ) : (
                    <span className="text-muted-foreground">no trace</span>
                  )}
                  <span className="grow truncate">{l.msg ?? l.raw}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        {data?.truncated ? (
          <div className="text-muted-foreground border-t px-3 py-1.5 text-[0.7rem]">
            Showing the most recent 200 lines. Use Grafana for older.
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function levelClass(level: string | null | undefined): string {
  switch ((level ?? "").toLowerCase()) {
    case "error":
    case "fatal":
      return "text-destructive";
    case "warn":
    case "warning":
      return "text-yellow-500";
    default:
      return "text-muted-foreground";
  }
}

function grafanaLogsUrl(traceFilter: string | null): string {
  // Best-effort deep link. We don't have the namespace client-side, so this
  // opens Loki Explore with no pre-filter — the user can refine inside
  // Grafana. F2 / a follow-up task can compute a more targeted URL.
  const expr = traceFilter
    ? `{namespace=~".+"} | json | trace_id="${traceFilter}"`
    : `{namespace=~".+"}`;
  const left = JSON.stringify({
    datasource: "loki",
    queries: [{ expr, refId: "A" }],
    range: { from: "now-1h", to: "now" },
  });
  return `http://grafana.lw-idp.local/explore?orgId=1&left=${encodeURIComponent(left)}`;
}
