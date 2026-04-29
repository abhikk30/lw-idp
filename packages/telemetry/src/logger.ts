import { trace } from "@opentelemetry/api";
import { type Logger, type LoggerOptions, pino } from "pino";

export interface LoggerConfig {
  service: string;
  level?: LoggerOptions["level"];
  env?: string;
}

/**
 * Pino mixin that injects the active OpenTelemetry trace context (`trace_id`
 * and `span_id`) into every log record, when one is present. Exported so it
 * can be unit-tested without spinning up a full pino destination.
 */
export function otelTraceMixin(): Record<string, string> {
  const span = trace.getActiveSpan();
  if (!span) {
    return {};
  }
  const ctx = span.spanContext();
  return { trace_id: ctx.traceId, span_id: ctx.spanId };
}

export function createLogger(config: LoggerConfig): Logger {
  return pino({
    name: config.service,
    level: config.level ?? process.env.LOG_LEVEL ?? "info",
    base: {
      service: config.service,
      env: config.env ?? process.env.NODE_ENV ?? "development",
      pid: process.pid,
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level: (label: string) => ({ level: label }),
    },
    mixin: otelTraceMixin,
  });
}
