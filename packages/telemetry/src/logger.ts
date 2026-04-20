import { type Logger, type LoggerOptions, pino } from "pino";

export interface LoggerConfig {
  service: string;
  level?: LoggerOptions["level"];
  env?: string;
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
  });
}
