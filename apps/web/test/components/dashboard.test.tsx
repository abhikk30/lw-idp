import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import DashboardPage from "../../src/app/(app)/page.js";

vi.hoisted(() => {
  process.env.GATEWAY_INTERNAL_URL = "http://test-gw.local/api/v1";
});

vi.mock("next/headers", () => ({
  headers: async () => new Map([["cookie", "lw-sid=sess_test"]]) as unknown as Headers,
}));

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("DashboardPage RSC", () => {
  it("renders recent services list when /services returns items", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/services", () =>
        HttpResponse.json({
          items: [
            {
              id: "svc-1",
              slug: "checkout",
              name: "checkout",
              type: "service",
              lifecycle: "production",
              ownerTeamId: "t-1",
              tags: [],
              createdAt: "2026-04-01T00:00:00Z",
              updatedAt: "2026-04-20T00:00:00Z",
            },
          ],
          nextCursor: null,
        }),
      ),
      http.get("http://test-gw.local/api/v1/clusters", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );

    const ui = await DashboardPage();
    render(ui as React.ReactElement);

    expect(screen.getByRole("heading", { level: 1, name: "Dashboard" })).toBeInTheDocument();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
  });

  it("renders empty-state CTA for services when list is empty", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/services", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
      http.get("http://test-gw.local/api/v1/clusters", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );

    const ui = await DashboardPage();
    render(ui as React.ReactElement);

    expect(screen.getByText(/no services yet/i)).toBeInTheDocument();
    expect(screen.getByText(/register service/i)).toBeInTheDocument();
  });

  it("renders error state when gateway returns 500 for services", async () => {
    server.use(
      http.get(
        "http://test-gw.local/api/v1/services",
        () => new HttpResponse(null, { status: 500 }),
      ),
      http.get("http://test-gw.local/api/v1/clusters", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
    );

    const ui = await DashboardPage();
    render(ui as React.ReactElement);

    expect(screen.getByText(/could not load services/i)).toBeInTheDocument();
  });

  it("renders cluster summary with environment badges", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/services", () =>
        HttpResponse.json({ items: [], nextCursor: null }),
      ),
      http.get("http://test-gw.local/api/v1/clusters", () =>
        HttpResponse.json({
          items: [
            {
              id: "cl-1",
              slug: "prod-east",
              name: "Prod East",
              environment: "prod",
              provider: "eks",
              createdAt: "2026-01-01T00:00:00Z",
            },
            {
              id: "cl-2",
              slug: "staging",
              name: "Staging",
              environment: "stage",
              provider: "kind",
              createdAt: "2026-02-01T00:00:00Z",
            },
          ],
          nextCursor: null,
        }),
      ),
    );

    const ui = await DashboardPage();
    render(ui as React.ReactElement);

    expect(screen.getByText("Prod East")).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
    expect(screen.getByText("Staging")).toBeInTheDocument();
    expect(screen.getByText("stage")).toBeInTheDocument();
    // "2 registered" appears in the CardDescription
    expect(screen.getByText(/2 registered/)).toBeInTheDocument();
  });
});
