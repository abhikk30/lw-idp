import { describe, expect, it } from "vitest";
import { serviceCreateSchema } from "../../src/forms/service.js";

describe("serviceCreateSchema", () => {
  it("accepts a minimal valid service", () => {
    const result = serviceCreateSchema.safeParse({
      slug: "checkout",
      name: "Checkout",
      type: "service",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty slug", () => {
    const result = serviceCreateSchema.safeParse({
      slug: "",
      name: "X",
      type: "service",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((i) => i.path[0] === "slug")).toBe(true);
    }
  });

  it("rejects an unknown type enum", () => {
    const result = serviceCreateSchema.safeParse({
      slug: "x",
      name: "X",
      type: "platform",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });

  it("accepts empty repoUrl as well as valid URL", () => {
    const ok1 = serviceCreateSchema.safeParse({
      slug: "x",
      name: "X",
      type: "service",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
      repoUrl: "",
    });
    const ok2 = serviceCreateSchema.safeParse({
      slug: "x",
      name: "X",
      type: "service",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
      repoUrl: "https://github.com/foo/bar",
    });
    expect(ok1.success).toBe(true);
    expect(ok2.success).toBe(true);
  });

  it("rejects bad slug characters", () => {
    const result = serviceCreateSchema.safeParse({
      slug: "Bad_Slug",
      name: "x",
      type: "service",
      lifecycle: "production",
      ownerTeamId: "11111111-1111-4111-8111-111111111111",
    });
    expect(result.success).toBe(false);
  });
});
