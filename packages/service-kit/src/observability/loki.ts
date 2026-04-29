export interface LokiLine {
  ts: string;
  raw: string;
  level: string | null;
  msg: string | null;
  trace_id: string | null;
  span_id: string | null;
  pod: string | null;
}

export interface LokiQueryRangeOpts {
  query: string;
  startNs: bigint;
  endNs: bigint;
  limit: number;
  direction?: "forward" | "backward";
}

export interface LokiClient {
  queryRange(opts: LokiQueryRangeOpts): Promise<{ lines: LokiLine[] }>;
}

export class LokiError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "LokiError";
  }
}

interface LokiStream {
  stream?: Record<string, string | undefined>;
  values?: [string, string][];
}

interface LokiQueryRangeResponse {
  data?: {
    result?: LokiStream[];
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function parseLine(
  value: [string, string],
  streamLabels: Record<string, string | undefined>,
): LokiLine {
  const [tsNsStr, raw] = value;
  const tsNs = BigInt(tsNsStr);
  const tsMs = Number(tsNs / 1_000_000n);
  const ts = new Date(tsMs).toISOString();

  let level: string | null = null;
  let msg: string | null = null;
  let trace_id: string | null = null;
  let span_id: string | null = null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === "object") {
      const o = parsed as Record<string, unknown>;
      level = pickString(o, "level");
      msg = pickString(o, "msg");
      trace_id = pickString(o, "trace_id") ?? pickString(o, "traceId");
      span_id = pickString(o, "span_id") ?? pickString(o, "spanId");
    }
  } catch {
    // not JSON — leave parsed fields as null and pass `raw` through
  }

  return {
    ts,
    raw,
    level,
    msg,
    trace_id,
    span_id,
    pod: streamLabels.pod ?? null,
  };
}

export function createLokiClient(opts: { baseUrl: string }): LokiClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return {
    async queryRange(q: LokiQueryRangeOpts): Promise<{ lines: LokiLine[] }> {
      const params = new URLSearchParams({
        query: q.query,
        start: q.startNs.toString(),
        end: q.endNs.toString(),
        limit: q.limit.toString(),
        direction: q.direction ?? "backward",
      });
      const url = `${baseUrl}/loki/api/v1/query_range?${params.toString()}`;
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new LokiError(res.status, `Loki query_range failed: ${res.status} ${body}`);
      }
      const json = (await res.json()) as LokiQueryRangeResponse;
      const lines: LokiLine[] = [];
      for (const stream of json.data?.result ?? []) {
        const labels = stream.stream ?? {};
        for (const v of stream.values ?? []) {
          lines.push(parseLine(v, labels));
        }
      }
      return { lines };
    },
  };
}
