import "server-only";

import type {
  Deployment,
  DeploymentAdapter,
  DeploymentList,
  DeploymentTriggerOptions,
} from "@lw-idp/contracts";

const FIXTURES: Deployment[] = [
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

export const mockDeploymentAdapter: DeploymentAdapter = {
  async list(serviceSlug: string): Promise<DeploymentList> {
    return { items: FIXTURES.filter((d) => d.serviceSlug === serviceSlug) };
  },
  async get(id: string): Promise<Deployment> {
    const found = FIXTURES.find((d) => d.id === id);
    if (!found) {
      throw new Error(`Deployment ${id} not found`);
    }
    return found;
  },
  async trigger(serviceSlug: string, opts: DeploymentTriggerOptions): Promise<Deployment> {
    return {
      id: `dep-${Math.random().toString(36).slice(2, 8)}`,
      serviceSlug,
      environment: opts.environment,
      status: "in_progress",
      commitSha: opts.commitSha ?? "deadbeef",
      createdAt: new Date().toISOString(),
      durationSeconds: 0,
    };
  },
};
