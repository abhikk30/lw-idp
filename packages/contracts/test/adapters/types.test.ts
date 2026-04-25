import { describe, expect, it } from "vitest";
import type { Deployment, Pipeline } from "../../src/adapters/index.js";

describe("adapter types", () => {
  it("Deployment shape compiles", () => {
    const d: Deployment = {
      id: "dep-1",
      serviceSlug: "checkout",
      environment: "prod",
      status: "succeeded",
      commitSha: "abc",
      createdAt: "2026-01-01T00:00:00Z",
      durationSeconds: 100,
    };
    expect(d.id).toBe("dep-1");
  });

  it("Pipeline shape compiles", () => {
    const p: Pipeline = {
      id: "pipe-1",
      serviceSlug: "billing",
      branch: "main",
      status: "success",
      triggeredBy: "alice",
      createdAt: "2026-01-01T00:00:00Z",
      durationSeconds: 100,
    };
    expect(p.id).toBe("pipe-1");
  });
});
