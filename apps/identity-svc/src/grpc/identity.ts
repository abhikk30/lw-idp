import { Code, ConnectError, type ServiceImpl } from "@connectrpc/connect";
import type { IdentityService } from "@lw-idp/contracts/identity/v1";

export const identityServiceImpl: ServiceImpl<typeof IdentityService> = {
  async verifyToken(_req) {
    throw new ConnectError("not implemented yet", Code.Unimplemented);
  },
  async getUser(_req) {
    throw new ConnectError("not implemented yet", Code.Unimplemented);
  },
  async listUsers(_req) {
    // Return empty list as a proof-of-wiring. Real impl in C2.
    return { users: [], nextPageToken: "" };
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
