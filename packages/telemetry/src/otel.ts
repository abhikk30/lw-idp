import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { Resource } from "@opentelemetry/resources";
import { NodeSDK } from "@opentelemetry/sdk-node";
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from "@opentelemetry/semantic-conventions";

export interface OtelConfig {
  service: string;
  version?: string;
  endpoint?: string;
}

export function startOtel(config: OtelConfig): NodeSDK {
  const sdk = new NodeSDK({
    resource: new Resource({
      [ATTR_SERVICE_NAME]: config.service,
      [ATTR_SERVICE_VERSION]: config.version ?? "0.0.0",
    }),
    traceExporter: new OTLPTraceExporter({
      url:
        config.endpoint ??
        process.env.OTEL_EXPORTER_OTLP_ENDPOINT ??
        "http://localhost:4318/v1/traces",
    }),
    instrumentations: [getNodeAutoInstrumentations()],
  });
  sdk.start();
  return sdk;
}
