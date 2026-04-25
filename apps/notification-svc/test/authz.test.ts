import type { SessionRecord } from "@lw-idp/auth";
import { createEnvelope } from "@lw-idp/events";
import { describe, expect, it } from "vitest";
import { canUserSeeEvent } from "../src/authz.js";

function mkSession(userId: string, teams: Array<{ id: string; slug: string }>): SessionRecord {
  return {
    userId,
    email: `${userId}@test`,
    displayName: userId,
    teams: teams.map((t) => ({ ...t, name: t.slug })),
    createdAt: new Date().toISOString(),
  };
}

const regular = mkSession("u-1", [{ id: "team-a", slug: "team-a" }]);
const admin = mkSession("admin-1", [
  { id: "plat", slug: "platform-admins" },
  { id: "team-a", slug: "team-a" },
]);

describe("canUserSeeEvent", () => {
  // 1 — user.created where actor is self
  it("allows user.created when actor is self", () => {
    const env = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: { id: "u-1" },
      actor: { userId: "u-1" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(true);
  });

  // 2 — user.created where actor is NOT self but session is admin
  it("allows user.created for non-self when admin", () => {
    const env = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: { id: "u-9" },
      actor: { userId: "u-9" },
    });
    expect(canUserSeeEvent(admin, env)).toBe(true);
  });

  // 3 — user.created neither
  it("denies user.created when not self and not admin", () => {
    const env = createEnvelope({
      type: "idp.identity.user.created",
      source: "identity-svc",
      data: { id: "u-9" },
      actor: { userId: "u-9" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(false);
  });

  // 4 — team.member.added with user_id = self
  it("allows team.member.added for the added user", () => {
    const env = createEnvelope({
      type: "idp.identity.team.member.added",
      source: "identity-svc",
      data: { team_id: "team-x", user_id: "u-1" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(true);
  });

  // 5 — team.member.added where team is in session
  it("allows team.member.added for team members", () => {
    const env = createEnvelope({
      type: "idp.identity.team.member.added",
      source: "identity-svc",
      data: { team_id: "team-a", user_id: "u-9" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(true);
  });

  // 6 — team.member.added neither
  it("denies team.member.added when not member and not added user", () => {
    const env = createEnvelope({
      type: "idp.identity.team.member.added",
      source: "identity-svc",
      data: { team_id: "team-z", user_id: "u-9" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(false);
  });

  // 7 — catalog.service.created owned by member's team
  it("allows catalog.service.created for owner team members", () => {
    const env = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: { id: "svc-1", owner_team_id: "team-a" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(true);
  });

  // 8 — catalog.service.created by other team, session is admin
  it("allows catalog.service.created for admins regardless of owner team", () => {
    const env = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: { id: "svc-2", owner_team_id: "team-z" },
    });
    expect(canUserSeeEvent(admin, env)).toBe(true);
  });

  // 9 — catalog.service.created unrelated
  it("denies catalog.service.created for non-owner non-admin", () => {
    const env = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: { id: "svc-3", owner_team_id: "team-z" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(false);
  });

  // 10 — cluster.registered by admin
  it("allows cluster.registered for admins", () => {
    const env = createEnvelope({
      type: "idp.cluster.cluster.registered",
      source: "cluster-svc",
      data: { id: "c-1" },
    });
    expect(canUserSeeEvent(admin, env)).toBe(true);
  });

  // 11 — cluster.registered by non-admin
  it("denies cluster.registered for non-admins", () => {
    const env = createEnvelope({
      type: "idp.cluster.cluster.registered",
      source: "cluster-svc",
      data: { id: "c-2" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(false);
  });

  // 12 — unknown type defaults deny
  it("denies unknown event types", () => {
    const env = createEnvelope({
      type: "idp.some.new.thing",
      source: "future-svc",
      data: { id: "x" },
    });
    expect(canUserSeeEvent(admin, env)).toBe(false);
  });

  // 13 — missing data
  it("denies malformed envelope with missing data", () => {
    const env = createEnvelope({
      type: "idp.catalog.service.created",
      source: "catalog-svc",
      data: {} as Record<string, unknown>,
    });
    // no owner_team_id present — regular user must be denied
    expect(canUserSeeEvent(regular, env)).toBe(false);
  });

  // BONUS — team.created: all authenticated allowed
  it("allows team.created for any authenticated user", () => {
    const env = createEnvelope({
      type: "idp.identity.team.created",
      source: "identity-svc",
      data: { team_id: "team-new" },
    });
    expect(canUserSeeEvent(regular, env)).toBe(true);
  });
});
