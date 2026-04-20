import { describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";

describe("createLogger", () => {
  it("returns a logger with service name bound", () => {
    const log = createLogger({ service: "test-svc", level: "info" });
    expect(typeof log.info).toBe("function");
    expect(log.bindings().service).toBe("test-svc");
  });
});
