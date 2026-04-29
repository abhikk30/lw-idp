import { describe, expect, it } from "vitest";
import { deployApplicationEventSchema, subjects } from "../src/index.js";

describe("deployApplicationEventSchema", () => {
  it("round-trips a happy-path Synced+Healthy event", () => {
    const ev = {
      app: "catalog-svc",
      revision: "abc1234",
      syncStatus: "Synced" as const,
      healthStatus: "Healthy" as const,
      operationPhase: "Succeeded" as const,
      at: "2026-04-29T05:30:00.000Z",
    };
    const parsed = deployApplicationEventSchema.parse(ev);
    expect(parsed).toEqual(ev);
  });

  it("accepts empty string operationPhase (no in-flight operation)", () => {
    const parsed = deployApplicationEventSchema.parse({
      app: "web",
      revision: "deadbeef",
      syncStatus: "Synced",
      healthStatus: "Healthy",
      operationPhase: "",
      at: "2026-04-29T05:30:00.000Z",
    });
    expect(parsed.operationPhase).toBe("");
  });

  it("treats operationPhase as optional", () => {
    const parsed = deployApplicationEventSchema.parse({
      app: "gateway-svc",
      revision: "deadbeef",
      syncStatus: "OutOfSync",
      healthStatus: "Progressing",
      at: "2026-04-29T05:30:00.000Z",
    });
    expect(parsed.operationPhase).toBeUndefined();
  });

  it("rejects an unknown syncStatus", () => {
    expect(() =>
      deployApplicationEventSchema.parse({
        app: "x",
        revision: "abc",
        syncStatus: "WhatIsThis",
        healthStatus: "Healthy",
        at: "2026-04-29T05:30:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects an unknown healthStatus", () => {
    expect(() =>
      deployApplicationEventSchema.parse({
        app: "x",
        revision: "abc",
        syncStatus: "Synced",
        healthStatus: "Confused",
        at: "2026-04-29T05:30:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects an empty app", () => {
    expect(() =>
      deployApplicationEventSchema.parse({
        app: "",
        revision: "abc",
        syncStatus: "Synced",
        healthStatus: "Healthy",
        at: "2026-04-29T05:30:00.000Z",
      }),
    ).toThrow();
  });

  it("rejects a non-ISO `at` timestamp", () => {
    expect(() =>
      deployApplicationEventSchema.parse({
        app: "x",
        revision: "abc",
        syncStatus: "Synced",
        healthStatus: "Healthy",
        at: "yesterday",
      }),
    ).toThrow();
  });
});

describe("deploy subjects", () => {
  it("exposes all four idp.deploy.application.* subjects", () => {
    expect(subjects.deployApplicationSynced).toBe("idp.deploy.application.synced");
    expect(subjects.deployApplicationDegraded).toBe("idp.deploy.application.degraded");
    expect(subjects.deployApplicationFailed).toBe("idp.deploy.application.failed");
    expect(subjects.deployApplicationRunning).toBe("idp.deploy.application.running");
  });

  it("each deploy subject is matched by the `idp.>` wildcard", () => {
    // notification-svc subscribes via this wildcard; ensure no orphan branch.
    const wild = subjects.allWildcard;
    expect(wild).toBe("idp.>");
    for (const s of [
      subjects.deployApplicationSynced,
      subjects.deployApplicationDegraded,
      subjects.deployApplicationFailed,
      subjects.deployApplicationRunning,
    ]) {
      expect(s.startsWith("idp.")).toBe(true);
    }
  });
});
