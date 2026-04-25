import type { paths } from "@lw-idp/contracts/gateway";

type TeamList = NonNullable<
  paths["/teams"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type TeamItem = TeamList["teams"][number];

export const teamsFixture: TeamItem[] = [
  { id: "team-platform-admins", slug: "platform-admins", name: "Platform Admins" },
  { id: "team-payments", slug: "payments", name: "Payments" },
  { id: "team-growth", slug: "growth", name: "Growth" },
];
