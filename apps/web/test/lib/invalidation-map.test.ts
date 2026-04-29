import { describe, expect, it } from "vitest";
import { humanizeFrame, invalidationKeysFor } from "../../src/lib/events/invalidation-map.js";

describe("invalidationKeysFor", () => {
  it("service.created returns ['services']", () => {
    expect(invalidationKeysFor("service", "created")).toEqual([["services"]]);
  });
  it("service.updated returns ['services']", () => {
    expect(invalidationKeysFor("service", "updated")).toEqual([["services"]]);
  });
  it("service.deleted returns ['services']", () => {
    expect(invalidationKeysFor("service", "deleted")).toEqual([["services"]]);
  });
  it("cluster.registered returns ['clusters']", () => {
    expect(invalidationKeysFor("cluster", "registered")).toEqual([["clusters"]]);
  });
  it("team.created returns ['teams', 'me']", () => {
    expect(invalidationKeysFor("team", "created")).toEqual([["teams"], ["me"]]);
  });
  it("user.created returns ['me']", () => {
    expect(invalidationKeysFor("user", "created")).toEqual([["me"]]);
  });
  it("unknown entity returns []", () => {
    expect(invalidationKeysFor("foobar", "created")).toEqual([]);
  });
  it("unknown action returns []", () => {
    expect(invalidationKeysFor("service", "scrambled")).toEqual([]);
  });

  // P2.0 E4: Argo CD application state events from notification-svc
  it("application.synced returns ['applications']", () => {
    expect(invalidationKeysFor("application", "synced")).toEqual([["applications"]]);
  });
  it("application.degraded returns ['applications']", () => {
    expect(invalidationKeysFor("application", "degraded")).toEqual([["applications"]]);
  });
  it("application.failed returns ['applications']", () => {
    expect(invalidationKeysFor("application", "failed")).toEqual([["applications"]]);
  });
  it("application.running returns ['applications']", () => {
    expect(invalidationKeysFor("application", "running")).toEqual([["applications"]]);
  });
  it("application.<unknown> returns []", () => {
    expect(invalidationKeysFor("application", "exploded")).toEqual([]);
  });
});

describe("humanizeFrame", () => {
  it('uses payload.name when present: "Service \\"checkout\\" created"', () => {
    expect(humanizeFrame("service", "created", { name: "checkout" })).toBe(
      'Service "checkout" created',
    );
  });
  it("falls back to slug", () => {
    expect(humanizeFrame("cluster", "registered", { slug: "prod-east" })).toBe(
      'Cluster "prod-east" created',
    );
  });
  it("uses entity when no name/slug", () => {
    expect(humanizeFrame("user", "created")).toBe("User user created");
  });

  // P2.0 E4: deploy state actions get sensible toast text
  it("application.synced + payload name → 'Application \"name\" synced'", () => {
    expect(humanizeFrame("application", "synced", { name: "catalog-svc" })).toBe(
      'Application "catalog-svc" synced',
    );
  });
  it("application.degraded → 'Application \"name\" degraded'", () => {
    expect(humanizeFrame("application", "degraded", { name: "web" })).toBe(
      'Application "web" degraded',
    );
  });
  it("application.failed → 'Application \"name\" sync failed'", () => {
    expect(humanizeFrame("application", "failed", { name: "gateway-svc" })).toBe(
      'Application "gateway-svc" sync failed',
    );
  });
});
