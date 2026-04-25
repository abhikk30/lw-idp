import type { paths } from "@lw-idp/contracts/gateway";

export type Me = NonNullable<
  paths["/me"]["get"]["responses"]["200"]["content"]["application/json"]
>;

export const meFixture: Me = {
  user: {
    id: "u-fixture-1",
    subject: "gh|fixture",
    email: "fixture@lw-idp.local",
    displayName: "Fixture User",
  },
  teams: [
    { id: "team-platform-admins", slug: "platform-admins", name: "Platform Admins" },
    { id: "team-payments", slug: "payments", name: "Payments" },
  ],
};
