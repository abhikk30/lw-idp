export interface PromPoint {
  ts: string;
  value: number;
}

export interface PromQueryRangeOpts {
  query: string;
  startMs: number;
  endMs: number;
  stepSec: number;
}

export interface PromClient {
  queryRange(opts: PromQueryRangeOpts): Promise<{ points: PromPoint[] }>;
}

export class PromError extends Error {
  constructor(
    public readonly status: number,
    msg: string,
  ) {
    super(msg);
    this.name = "PromError";
  }
}

interface PromResponse {
  status?: string;
  data?: {
    resultType?: string;
    result?: {
      metric?: Record<string, string>;
      values?: [number, string][];
    }[];
  };
}

export function createPromClient(opts: { baseUrl: string }): PromClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  return {
    async queryRange({ query, startMs, endMs, stepSec }): Promise<{ points: PromPoint[] }> {
      const url = new URL("/api/v1/query_range", baseUrl);
      url.searchParams.set("query", query);
      url.searchParams.set("start", String(startMs / 1000));
      url.searchParams.set("end", String(endMs / 1000));
      url.searchParams.set("step", `${stepSec}s`);
      const res = await fetch(url);
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new PromError(res.status, `Prom query_range failed: ${res.status} ${body}`);
      }
      const json = (await res.json()) as PromResponse;
      const series = json.data?.result?.[0]?.values ?? [];
      return {
        points: series.map(([secStr, valStr]) => ({
          ts: new Date(Number(secStr) * 1000).toISOString(),
          value: Number(valStr),
        })),
      };
    },
  };
}
