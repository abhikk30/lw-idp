import { describe, expect, it } from "vitest";
import { createEnvelope, envelopeSchema, subjects } from "../src/index.js";

describe("event envelope", () => {
  it("creates a valid CloudEvents-style envelope", () => {
    const env = createEnvelope({
      type: subjects.catalogServiceCreated,
      source: "catalog-svc",
      data: { id: "s_1", slug: "payments-api" },
      actor: { userId: "u_1" },
    });
    expect(env.id).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/); // ULID
    expect(env.type).toBe("idp.catalog.service.created");
    expect(env.specVersion).toBe("1.0");
    const parsed = envelopeSchema.parse(env);
    expect(parsed).toEqual(env);
  });

  it("rejects missing required fields", () => {
    expect(() => envelopeSchema.parse({})).toThrow();
  });
});
