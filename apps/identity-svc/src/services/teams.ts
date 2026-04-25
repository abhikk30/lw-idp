import { createEnvelope } from "@lw-idp/events";
import { asc, eq, gt } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import {
  type NewTeam,
  type NewTeamMembership,
  type Team,
  type TeamMembership,
  outbox,
  teamMemberships,
  teams,
} from "../db/schema/index.js";

export interface CreateTeamInput {
  slug: string;
  name: string;
  actorUserId?: string;
}

export async function createTeam(db: PostgresJsDatabase, input: CreateTeamInput): Promise<Team> {
  return db.transaction(async (tx) => {
    const values: NewTeam = { slug: input.slug, name: input.name };
    const [created] = await tx.insert(teams).values(values).returning();
    if (!created) {
      throw new Error("team insert failed");
    }

    const envelope = createEnvelope({
      type: "idp.identity.team.created",
      source: "identity-svc",
      // team_id duplicates id so notification-svc authz can filter on a stable snake_case key.
      data: { id: created.id, team_id: created.id, slug: created.slug, name: created.name },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "team",
      eventType: envelope.type,
      payload: envelope,
    });
    return created;
  });
}

export type MemberRole = "owner" | "maintainer" | "member";

export interface AddMemberInput {
  teamId: string;
  userId: string;
  role: MemberRole;
  actorUserId?: string;
}

export async function addTeamMember(
  db: PostgresJsDatabase,
  input: AddMemberInput,
): Promise<TeamMembership> {
  return db.transaction(async (tx) => {
    const values: NewTeamMembership = {
      teamId: input.teamId,
      userId: input.userId,
      role: input.role,
    };
    // On conflict (composite PK), update role and return
    const [row] = await tx
      .insert(teamMemberships)
      .values(values)
      .onConflictDoUpdate({
        target: [teamMemberships.teamId, teamMemberships.userId],
        set: { role: input.role },
      })
      .returning();
    if (!row) {
      throw new Error("team membership upsert failed");
    }

    const envelope = createEnvelope({
      type: "idp.identity.team.member.added",
      source: "identity-svc",
      // team_id / user_id duplicate teamId / userId so notification-svc authz can filter on
      // the snake_case keys it uses in its rule table.
      data: {
        teamId: row.teamId,
        userId: row.userId,
        team_id: row.teamId,
        user_id: row.userId,
        role: row.role,
      },
      ...(input.actorUserId !== undefined ? { actor: { userId: input.actorUserId } } : {}),
    });
    await tx.insert(outbox).values({
      aggregate: "team_membership",
      eventType: envelope.type,
      payload: envelope,
    });

    return row;
  });
}

export interface ListTeamsResult {
  teams: Team[];
  nextPageToken: string;
}

export async function listTeams(
  db: PostgresJsDatabase,
  opts: { limit?: number; pageToken?: string },
): Promise<ListTeamsResult> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  let cursor: string | undefined;
  if (opts.pageToken && opts.pageToken.length > 0) {
    try {
      cursor = Buffer.from(opts.pageToken, "base64url").toString("utf8");
    } catch {
      cursor = undefined;
    }
  }

  const rows = await db
    .select()
    .from(teams)
    .where(cursor ? gt(teams.id, cursor) : undefined)
    .orderBy(asc(teams.id))
    .limit(limit + 1);

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const lastId = page[page.length - 1]?.id ?? "";
  const next = hasMore ? Buffer.from(lastId, "utf8").toString("base64url") : "";
  return { teams: page, nextPageToken: next };
}

export async function getTeamsForUser(db: PostgresJsDatabase, userId: string): Promise<Team[]> {
  const rows = await db
    .select({
      id: teams.id,
      slug: teams.slug,
      name: teams.name,
      createdAt: teams.createdAt,
    })
    .from(teams)
    .innerJoin(teamMemberships, eq(teamMemberships.teamId, teams.id))
    .where(eq(teamMemberships.userId, userId))
    .orderBy(asc(teams.slug));
  return rows;
}
