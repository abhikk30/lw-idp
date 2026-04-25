import type { Deployment, Pipeline } from "@lw-idp/contracts";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { DeploymentsTable } from "../../src/components/mocked/deployments-table.client.js";
import { PipelinesTable } from "../../src/components/mocked/pipelines-table.client.js";

afterEach(cleanup);

const deployments: Deployment[] = [
  {
    id: "dep-001",
    serviceSlug: "checkout",
    environment: "prod",
    status: "succeeded",
    commitSha: "abc",
    createdAt: "2026-04-23T10:00:00Z",
    durationSeconds: 142,
  },
  {
    id: "dep-002",
    serviceSlug: "checkout",
    environment: "prod",
    status: "failed",
    commitSha: "def",
    createdAt: "2026-04-24T10:00:00Z",
    durationSeconds: 87,
  },
];

const pipelines: Pipeline[] = [
  {
    id: "pipe-001",
    serviceSlug: "checkout",
    branch: "main",
    status: "success",
    triggeredBy: "alice",
    createdAt: "2026-04-25T08:00:00Z",
    durationSeconds: 312,
  },
];

describe("Mocked integration tables", () => {
  it("DeploymentsTable renders rows with statuses", () => {
    render(<DeploymentsTable deployments={deployments} />);
    expect(screen.getByText("abc")).toBeInTheDocument();
    expect(screen.getByText("succeeded")).toBeInTheDocument();
    expect(screen.getByText("failed")).toBeInTheDocument();
  });

  it("DeploymentsTable empty state", () => {
    render(<DeploymentsTable deployments={[]} />);
    expect(screen.getByText(/no deployments yet/i)).toBeInTheDocument();
  });

  it("PipelinesTable renders rows", () => {
    render(<PipelinesTable pipelines={pipelines} />);
    expect(screen.getByText("alice")).toBeInTheDocument();
    expect(screen.getByText("success")).toBeInTheDocument();
  });

  it("PipelinesTable empty state", () => {
    render(<PipelinesTable pipelines={[]} />);
    expect(screen.getByText(/no pipelines yet/i)).toBeInTheDocument();
  });
});
