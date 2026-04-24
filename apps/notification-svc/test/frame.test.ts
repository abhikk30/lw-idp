import { createEnvelope } from "@lw-idp/events";
import { describe, expect, it } from "vitest";
import { envelopeToFrame } from "../src/frame.js";

describe("envelopeToFrame", () => {
  it("splits idp.catalog.service.created into entity=service, action=created", () => {
    const env = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: { id: "abc", owner_team_id: "t-1" },
    });
    const frame = envelopeToFrame(env);
    expect(frame.type).toBe("idp.catalog.service.created");
    expect(frame.entity).toBe("service");
    expect(frame.action).toBe("created");
    expect(frame.payload).toEqual({ id: "abc", owner_team_id: "t-1" });
    expect(frame.id).toBe(env.id);
    expect(frame.ts).toBe(env.time);
  });

  it("propagates traceId when present", () => {
    const env = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: {},
      traceId: "tr-1",
    });
    const frame = envelopeToFrame(env);
    expect(frame.traceId).toBe("tr-1");
  });

  it("handles unknown single-segment type with fallbacks", () => {
    const env = createEnvelope({
      type: "weird",
      source: "test",
      data: {},
    });
    const frame = envelopeToFrame(env);
    expect(frame.action).toBe("weird");
    expect(frame.entity).toBe("weird");
  });
});
