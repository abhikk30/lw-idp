import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { OidcVerifier } from "@lw-idp/auth";
import type { IdentityService } from "@lw-idp/contracts/identity/v1";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { User as UserRow } from "../db/schema/index.js";
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
      return {
        user: toProtoUser(user),
        teams: [], // populated in C3 once team handlers land
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

    async createTeam(_req) {
      throw new ConnectError("not implemented yet", Code.Unimplemented);
    },
    async addTeamMember(_req) {
      throw new ConnectError("not implemented yet", Code.Unimplemented);
    },
    async listTeams(_req) {
      return { teams: [], nextPageToken: "" };
    },
    async getMyTeams(_req) {
      return { teams: [] };
    },
  };
}
