export interface TraceSummary {
  trace_id: string;
  root_service: string;
  root_operation: string;
  started_at: string;
  duration_ms: number;
  span_count: number;
  status: "ok" | "error";
}

export interface SpanNode {
  span_id: string;
  parent_id: string | null;
  service: string;
  name: string;
  started_at: string;
  duration_ms: number;
  status: "ok" | "error";
  attributes: Record<string, string | number | boolean>;
}

export interface TempoClient {
  searchTraces(opts: {
    serviceName: string;
    sinceMs: number;
    limit: number;
  }): Promise<TraceSummary[]>;
  getTrace(traceId: string): Promise<{ trace_id: string; spans: SpanNode[] } | null>;
}

export class TempoError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "TempoError";
  }
}

interface RawAttrValue {
  stringValue?: string;
  intValue?: number | string;
  boolValue?: boolean;
}
interface RawAttribute {
  key?: string;
  value?: RawAttrValue;
}
interface RawSearchTrace {
  traceID?: string;
  rootServiceName?: string;
  rootTraceName?: string;
  startTimeUnixNano?: string;
  durationMs?: number;
  spanSet?: { spans?: { status?: string }[] };
}
interface RawSpan {
  spanId?: string;
  parentSpanId?: string;
  name?: string;
  startTimeUnixNano?: string;
  endTimeUnixNano?: string;
  status?: { code?: number };
  attributes?: RawAttribute[];
}
interface RawBatch {
  resource?: { attributes?: RawAttribute[] };
  scopeSpans?: { spans?: RawSpan[] }[];
}

function nanoStringToIso(nanoStr: string | undefined): string {
  const ns = BigInt(nanoStr ?? "0");
  return new Date(Number(ns / 1_000_000n)).toISOString();
}

function attrValue(v: RawAttrValue | undefined): string | number | boolean | undefined {
  if (!v) {
    return undefined;
  }
  if (typeof v.stringValue === "string") {
    return v.stringValue;
  }
  if (typeof v.intValue === "number") {
    return v.intValue;
  }
  if (typeof v.intValue === "string") {
    return Number(v.intValue);
  }
  if (typeof v.boolValue === "boolean") {
    return v.boolValue;
  }
  return undefined;
}

function serviceNameFromResource(batch: RawBatch): string {
  for (const a of batch.resource?.attributes ?? []) {
    if (a.key === "service.name") {
      const v = attrValue(a.value);
      if (typeof v === "string") {
        return v;
      }
    }
  }
  return "";
}

function parseSpan(raw: RawSpan, service: string): SpanNode {
  const startNs = BigInt(raw.startTimeUnixNano ?? "0");
  const endNs = BigInt(raw.endTimeUnixNano ?? "0");
  const attributes: Record<string, string | number | boolean> = {};
  for (const a of raw.attributes ?? []) {
    if (typeof a.key !== "string") {
      continue;
    }
    const v = attrValue(a.value);
    if (v !== undefined) {
      attributes[a.key] = v;
    }
  }
  const parentId = raw.parentSpanId;
  return {
    span_id: raw.spanId ?? "",
    parent_id: typeof parentId === "string" && parentId.length > 0 ? parentId : null,
    service,
    name: raw.name ?? "",
    started_at: nanoStringToIso(raw.startTimeUnixNano),
    duration_ms: Number((endNs - startNs) / 1_000_000n),
    status: raw.status?.code === 2 ? "error" : "ok",
    attributes,
  };
}

export function createTempoClient(opts: { baseUrl: string }): TempoClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return {
    async searchTraces(q): Promise<TraceSummary[]> {
      const nowSec = Math.floor(Date.now() / 1000);
      const startSec = nowSec - Math.floor(q.sinceMs / 1000);
      const params = new URLSearchParams({
        q: `{ resource.service.name="${q.serviceName}" }`,
        limit: q.limit.toString(),
        start: startSec.toString(),
        end: nowSec.toString(),
      });
      const res = await fetch(`${baseUrl}/api/search?${params.toString()}`);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new TempoError(res.status, `Tempo search failed: ${res.status} ${body}`);
      }
      const json = (await res.json()) as { traces?: RawSearchTrace[] };
      return (json.traces ?? []).map((t) => {
        const spans = t.spanSet?.spans ?? [];
        const hasError = spans.some((s) => s.status === "STATUS_CODE_ERROR");
        return {
          trace_id: t.traceID ?? "",
          root_service: t.rootServiceName ?? "",
          root_operation: t.rootTraceName ?? "",
          started_at: nanoStringToIso(t.startTimeUnixNano),
          duration_ms: typeof t.durationMs === "number" ? t.durationMs : 0,
          span_count: spans.length,
          status: hasError ? "error" : "ok",
        };
      });
    },

    async getTrace(traceId: string): Promise<{ trace_id: string; spans: SpanNode[] } | null> {
      const res = await fetch(`${baseUrl}/api/traces/${encodeURIComponent(traceId)}`);
      if (res.status === 404) {
        return null;
      }
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new TempoError(res.status, `Tempo get-trace failed: ${res.status} ${body}`);
      }
      const json = (await res.json()) as { batches?: RawBatch[] };
      const spans: SpanNode[] = [];
      for (const batch of json.batches ?? []) {
        const service = serviceNameFromResource(batch);
        for (const ss of batch.scopeSpans ?? []) {
          for (const raw of ss.spans ?? []) {
            spans.push(parseSpan(raw, service));
          }
        }
      }
      spans.sort((a, b) =>
        a.started_at < b.started_at ? -1 : a.started_at > b.started_at ? 1 : 0,
      );
      return { trace_id: traceId, spans };
    },
  };
}
