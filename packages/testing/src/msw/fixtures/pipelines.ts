import type { Pipeline } from "@lw-idp/contracts";

export const pipelinesFixture: Pipeline[] = [
  {
    id: "pipe-001",
    serviceSlug: "checkout",
    branch: "main",
    status: "success",
    triggeredBy: "alice",
    createdAt: "2026-04-25T08:00:00Z",
    durationSeconds: 312,
  },
  {
    id: "pipe-002",
    serviceSlug: "checkout",
    branch: "feature/discount-codes",
    status: "running",
    triggeredBy: "bob",
    createdAt: "2026-04-25T09:30:00Z",
    durationSeconds: 0,
  },
  {
    id: "pipe-003",
    serviceSlug: "billing",
    branch: "main",
    status: "failed",
    triggeredBy: "alice",
    createdAt: "2026-04-24T13:30:00Z",
    durationSeconds: 198,
  },
];
