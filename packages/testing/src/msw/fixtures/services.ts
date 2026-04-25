import type { paths } from "@lw-idp/contracts/gateway";

type ServiceList = NonNullable<
  paths["/services"]["get"]["responses"]["200"]["content"]["application/json"]
>;
export type ServiceItem = ServiceList["items"][number];

export const servicesFixture: ServiceItem[] = [
  {
    id: "svc-checkout",
    slug: "checkout",
    name: "checkout",
    description: "Cart and order placement",
    type: "service",
    lifecycle: "production",
    ownerTeamId: "team-payments",
    repoUrl: "https://github.com/lw-idp/checkout",
    tags: ["go", "payments"],
    createdAt: "2026-01-10T10:00:00Z",
    updatedAt: "2026-04-01T08:30:00Z",
  },
  {
    id: "svc-billing",
    slug: "billing",
    name: "billing",
    description: "Subscription billing engine",
    type: "service",
    lifecycle: "production",
    ownerTeamId: "team-payments",
    repoUrl: "https://github.com/lw-idp/billing",
    tags: ["typescript", "payments"],
    createdAt: "2026-02-14T11:00:00Z",
    updatedAt: "2026-04-20T15:00:00Z",
  },
  {
    id: "svc-fraud-check",
    slug: "fraud-check",
    name: "fraud-check",
    description: "Risk-scoring service (experimental)",
    type: "service",
    lifecycle: "experimental",
    ownerTeamId: "team-platform-admins",
    repoUrl: "https://github.com/lw-idp/fraud-check",
    tags: ["python", "ml"],
    createdAt: "2026-03-30T09:00:00Z",
    updatedAt: "2026-04-22T10:00:00Z",
  },
];
