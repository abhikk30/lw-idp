import type { Deployment } from "@lw-idp/contracts";

export const deploymentsFixture: Deployment[] = [
  {
    id: "dep-001",
    serviceSlug: "checkout",
    environment: "prod",
    status: "succeeded",
    commitSha: "a1b2c3d4",
    createdAt: "2026-04-23T10:00:00Z",
    durationSeconds: 142,
  },
  {
    id: "dep-002",
    serviceSlug: "checkout",
    environment: "prod",
    status: "in_progress",
    commitSha: "e5f6g7h8",
    createdAt: "2026-04-25T08:30:00Z",
    durationSeconds: 0,
  },
  {
    id: "dep-003",
    serviceSlug: "billing",
    environment: "stage",
    status: "failed",
    commitSha: "i9j0k1l2",
    createdAt: "2026-04-24T14:00:00Z",
    durationSeconds: 87,
  },
];
