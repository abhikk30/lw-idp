"use client";

import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@lw-idp/ui/components/sheet";
import { useQuery } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import type { ReactNode } from "react";
import { apiClient } from "../../lib/api/client.js";

export function TraceDrawer({
  traceId,
  onClose,
}: {
  traceId: string;
  onClose: () => void;
}): ReactNode {
  const sp = useSearchParams();
  const router = useRouter();

  const { data, isLoading, error } = useQuery({
    queryKey: ["trace", traceId],
    queryFn: async () => {
      const res = await apiClient().GET("/observability/traces/{traceId}", {
        params: { path: { traceId } },
      });
      if (res.error || !res.data) {
        throw new Error("Failed to load trace");
      }
      return res.data;
    },
  });

  function showLogsForThisTrace(): void {
    const np = new URLSearchParams(sp.toString());
    np.set("trace_id", traceId);
    router.replace(`?${np.toString()}`);
    onClose();
  }

  return (
    <Sheet
      open
      onOpenChange={(o: boolean) => {
        if (!o) {
          onClose();
        }
      }}
    >
      <SheetContent className="w-full max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono">Trace {traceId.slice(0, 11)}…</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          <button
            type="button"
            onClick={showLogsForThisTrace}
            className="text-primary mb-3 text-sm underline"
          >
            Show logs for this trace ↗
          </button>
          {isLoading ? (
            <div className="text-muted-foreground text-sm">Loading…</div>
          ) : error ? (
            <div className="text-destructive text-sm">Trace unavailable</div>
          ) : (
            <ul className="space-y-1 font-mono text-xs">
              {(data?.spans ?? []).map((s) => (
                <li
                  key={s.span_id}
                  className="border-l-2 pl-2"
                  style={{ marginLeft: depthOf(s, data?.spans ?? []) * 16 }}
                >
                  <span className={s.status === "error" ? "text-destructive" : ""}>
                    {s.service}
                  </span>{" "}
                  <span className="text-muted-foreground">{s.name}</span>{" "}
                  <span>{Math.round(s.duration_ms)}ms</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function depthOf(
  s: { parent_id: string | null },
  all: Array<{ span_id: string; parent_id: string | null }>,
): number {
  let d = 0;
  let cur: string | null = s.parent_id;
  while (cur) {
    d += 1;
    const p = all.find((x) => x.span_id === cur);
    if (!p) {
      break;
    }
    cur = p.parent_id;
  }
  return d;
}
