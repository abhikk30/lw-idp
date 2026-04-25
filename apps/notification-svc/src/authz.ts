import type { SessionRecord } from "@lw-idp/auth";
import type { Envelope } from "@lw-idp/events";

const PLATFORM_ADMIN_SLUG = "platform-admins";

function isPlatformAdmin(session: SessionRecord): boolean {
  return session.teams.some((t) => t.slug === PLATFORM_ADMIN_SLUG);
}

function userTeamIds(session: SessionRecord): Set<string> {
  return new Set(session.teams.map((t) => t.id));
}

/**
 * Returns true iff the session should receive this envelope over its WS.
 * Default-deny on unknown envelope.type. See plan §"Unit test coverage targets (authz.test.ts)".
 */
export function canUserSeeEvent(session: SessionRecord, env: Envelope): boolean {
  const data = env.data as Record<string, unknown> | undefined;
  if (!data || typeof data !== "object") {
    return false;
  }
  const teamIds = userTeamIds(session);

  switch (env.type) {
    case "idp.identity.user.created": {
      // Allow if the created user IS the session (self); allow platform-admins.
      if (env.actor?.userId === session.userId) {
        return true;
      }
      if (isPlatformAdmin(session)) {
        return true;
      }
      return false;
    }
    case "idp.identity.team.created": {
      // All authenticated users can learn about new teams (public info).
      return true;
    }
    case "idp.identity.team.member.added": {
      // Allow: the added user, members of the team, platform-admins.
      const userId = typeof data.user_id === "string" ? data.user_id : undefined;
      const teamId = typeof data.team_id === "string" ? data.team_id : undefined;
      if (userId === session.userId) {
        return true;
      }
      if (teamId && teamIds.has(teamId)) {
        return true;
      }
      if (isPlatformAdmin(session)) {
        return true;
      }
      return false;
    }
    case "idp.catalog.service.created":
    case "idp.catalog.service.updated":
    case "idp.catalog.service.deleted": {
      const ownerTeamId = typeof data.owner_team_id === "string" ? data.owner_team_id : undefined;
      if (ownerTeamId && teamIds.has(ownerTeamId)) {
        return true;
      }
      if (isPlatformAdmin(session)) {
        return true;
      }
      return false;
    }
    case "idp.cluster.cluster.registered":
    case "idp.cluster.cluster.updated":
    case "idp.cluster.cluster.deregistered": {
      // Cluster CRUD events are platform-admin-only (spec §7.6).
      return isPlatformAdmin(session);
    }
    default: {
      // Default-deny on unknown subject.
      return false;
    }
  }
}
