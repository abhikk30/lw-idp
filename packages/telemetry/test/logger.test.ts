import { type Span, trace } from "@opentelemetry/api";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLogger, otelTraceMixin } from "../src/logger.js";

describe("createLogger", () => {
  it("returns a logger with service name bound", () => {
    const log = createLogger({ service: "test-svc", level: "info" });
    expect(typeof log.info).toBe("function");
    expect(log.bindings().service).toBe("test-svc");
  });
});

describe("otelTraceMixin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty object when no active span is present", () => {
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(undefined);
    const fields = otelTraceMixin();
    expect(fields).toEqual({});
    expect(fields).not.toHaveProperty("trace_id");
    expect(fields).not.toHaveProperty("span_id");
  });

  it("returns trace_id and span_id when an active span is present", () => {
    const fakeSpan = {
      spanContext: () => ({
        traceId: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
        spanId: "9f8e7d6c5b4a3f2e",
        traceFlags: 1,
      }),
    } as unknown as Span;
    vi.spyOn(trace, "getActiveSpan").mockReturnValue(fakeSpan);

    const fields = otelTraceMixin();
    expect(fields).toEqual({
      trace_id: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d",
      span_id: "9f8e7d6c5b4a3f2e",
    });
  });
});
