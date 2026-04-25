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
});
