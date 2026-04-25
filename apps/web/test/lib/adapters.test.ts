import { describe, expect, it } from "vitest";
import { mockDeploymentAdapter } from "../../src/lib/adapters/deployments.mock.js";
import { mockPipelineAdapter } from "../../src/lib/adapters/pipelines.mock.js";

describe("mockDeploymentAdapter", () => {
  it("list filters by serviceSlug", async () => {
    const { items } = await mockDeploymentAdapter.list("checkout");
    expect(items).toHaveLength(2);
    expect(items.every((d) => d.serviceSlug === "checkout")).toBe(true);
  });

  it("list returns [] for unknown slug", async () => {
    const { items } = await mockDeploymentAdapter.list("unknown");
    expect(items).toEqual([]);
  });

  it("get returns the matching deployment", async () => {
    const d = await mockDeploymentAdapter.get("dep-001");
    expect(d.id).toBe("dep-001");
  });

  it("trigger synthesizes a new in_progress deployment", async () => {
    const d = await mockDeploymentAdapter.trigger("checkout", {
      environment: "prod",
      commitSha: "abc",
    });
    expect(d.status).toBe("in_progress");
    expect(d.serviceSlug).toBe("checkout");
    expect(d.commitSha).toBe("abc");
  });
});

describe("mockPipelineAdapter", () => {
  it("list filters by serviceSlug", async () => {
    const { items } = await mockPipelineAdapter.list("checkout");
    expect(items).toHaveLength(2);
  });

  it("get returns the matching pipeline", async () => {
    const p = await mockPipelineAdapter.get("pipe-001");
    expect(p.id).toBe("pipe-001");
  });
});
