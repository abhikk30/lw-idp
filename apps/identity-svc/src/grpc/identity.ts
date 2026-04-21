import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { OidcVerifier } from "@lw-idp/auth";
import { type IdentityService, Role } from "@lw-idp/contracts/identity/v1";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Team as TeamRow, User as UserRow } from "../db/schema/index.js";
import {
  type MemberRole,
  addTeamMember,
  createTeam,
  getTeamsForUser,
  listTeams,
} from "../services/teams.js";
import { getUserById, listUsers, upsertUserBySubject } from "../services/users.js";

export interface IdentityServiceDeps {
  db: PostgresJsDatabase;
  verifier: OidcVerifier;
}

function toProtoUser(row: UserRow): {
  id: string;
  subject: string;
  email: string;
  displayName: string;
  avatarUrl: string;
  createdAt: ReturnType<typeof timestampFromDate>;
} {
  return {
    id: row.id,
    subject: row.subject,
    email: row.email,
    displayName: row.displayName ?? "",
    avatarUrl: row.avatarUrl ?? "",
    createdAt: timestampFromDate(row.createdAt),
  };
}

function dbRoleFromProto(role: Role): MemberRole {
  if (role === Role.OWNER) {
    return "owner";
  }
  if (role === Role.MAINTAINER) {
    return "maintainer";
  }
  return "member";
}

function toProtoTeam(row: TeamRow): {
  id: string;
  slug: string;
  name: string;
  createdAt: ReturnType<typeof timestampFromDate>;
} {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    createdAt: timestampFromDate(row.createdAt),
  };
}

export function makeIdentityServiceImpl(
  deps: IdentityServiceDeps,
): ServiceImpl<typeof IdentityService> {
  return {
    async verifyToken(req) {
      if (!req.idToken) {
        throw new ConnectError("id_token required", Code.InvalidArgument);
      }
      let claims: Awaited<ReturnType<OidcVerifier>>;
      try {
        claims = await deps.verifier(req.idToken);
      } catch (err) {
        throw new ConnectError(
          `token verification failed: ${err instanceof Error ? err.message : String(err)}`,
          Code.Unauthenticated,
        );
      }
      const upsertInput: import("../services/users.js").UpsertUserInput = {
        subject: claims.sub,
        email: claims.email ?? `${claims.sub}@unknown`,
      };
      if (claims.name !== undefined) {
        upsertInput.displayName = claims.name;
      }
      const picture = (claims as { picture?: string }).picture;
      if (picture !== undefined) {
        upsertInput.avatarUrl = picture;
      }
      const user = await upsertUserBySubject(deps.db, upsertInput);
      const teamsForUser = await getTeamsForUser(deps.db, user.id);
      return {
        user: toProtoUser(user),
        teams: teamsForUser.map(toProtoTeam),
      };
    },

    async getUser(req) {
      if (!req.id) {
        throw new ConnectError("id required", Code.InvalidArgument);
      }
      const row = await getUserById(deps.db, req.id);
      if (!row) {
        throw new ConnectError(`user not found: ${req.id}`, Code.NotFound);
      }
      return { user: toProtoUser(row) };
    },

    async listUsers(req) {
      const listOpts: { limit?: number; pageToken?: string } = {};
      if (req.limit > 0) {
        listOpts.limit = req.limit;
      }
      if (req.pageToken) {
        listOpts.pageToken = req.pageToken;
      }
      const res = await listUsers(deps.db, listOpts);
      return {
        users: res.users.map(toProtoUser),
        nextPageToken: res.nextPageToken,
      };
    },

    async createTeam(req) {
      if (!req.slug || !req.name) {
        throw new ConnectError("slug and name required", Code.InvalidArgument);
      }
      try {
        const team = await createTeam(deps.db, { slug: req.slug, name: req.name });
        return { team: toProtoTeam(team) };
      } catch (err) {
        if (err instanceof Error && /duplicate key/i.test(err.message)) {
          throw new ConnectError(`team with slug '${req.slug}' already exists`, Code.AlreadyExists);
        }
        throw err;
      }
    },

    async addTeamMember(req) {
      if (!req.teamId || !req.userId) {
        throw new ConnectError("team_id and user_id required", Code.InvalidArgument);
      }
      await addTeamMember(deps.db, {
        teamId: req.teamId,
        userId: req.userId,
        role: dbRoleFromProto(req.role),
      });
      return {};
    },

    async listTeams(req) {
      const listOpts: { limit?: number; pageToken?: string } = {};
      if (req.limit > 0) {
        listOpts.limit = req.limit;
      }
      if (req.pageToken) {
        listOpts.pageToken = req.pageToken;
      }
      const res = await listTeams(deps.db, listOpts);
      return {
        teams: res.teams.map(toProtoTeam),
        nextPageToken: res.nextPageToken,
      };
    },

    async getMyTeams(req) {
      if (!req.userId) {
        throw new ConnectError("user_id required", Code.InvalidArgument);
      }
      const rows = await getTeamsForUser(deps.db, req.userId);
      return { teams: rows.map(toProtoTeam) };
    },
  };
}
