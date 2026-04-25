import { describe, expect, it } from "vitest";
import { clusterRegisterSchema } from "../../src/forms/cluster.js";

describe("clusterRegisterSchema", () => {
  it("accepts a valid cluster", () => {
    const result = clusterRegisterSchema.safeParse({
      slug: "prod-us-east",
      name: "Prod US East",
      environment: "prod",
      region: "us-east-1",
      provider: "eks",
      apiEndpoint: "https://kube.prod.lw-idp.internal:6443",
    });
    expect(result.success).toBe(true);
  });

  it("rejects http:// apiEndpoint", () => {
    const result = clusterRegisterSchema.safeParse({
      slug: "x",
      name: "X",
      environment: "prod",
      region: "us-east-1",
      provider: "eks",
      apiEndpoint: "http://kube.prod.lw-idp.internal:6443",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "apiEndpoint")).toBe(true);
    }
  });

  it("rejects an unknown provider", () => {
    const result = clusterRegisterSchema.safeParse({
      slug: "x",
      name: "X",
      environment: "prod",
      region: "us-east-1",
      provider: "openshift",
      apiEndpoint: "https://kube.example.com",
    });
    expect(result.success).toBe(false);
  });
});
