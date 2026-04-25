import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import type React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.GATEWAY_INTERNAL_URL = "http://test-gw.local/api/v1";
});

vi.mock("next/headers", () => ({
  headers: async () => new Map([["cookie", "lw-sid=sess_test"]]) as unknown as Headers,
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  usePathname: () => "/services/svc-1",
}));

import ServiceOverviewPage from "../../src/app/(app)/services/[id]/page.js";
import { ServiceTabs } from "../../src/components/services/service-tabs.client.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Service detail (D4)", () => {
  it("Overview RSC renders service fields", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/services/svc-1", () =>
        HttpResponse.json({
          id: "svc-1",
          slug: "checkout",
          name: "Checkout",
          description: "Cart and order placement",
          type: "service",
          lifecycle: "production",
          ownerTeamId: "t-payments",
          repoUrl: "https://github.com/foo/checkout",
          tags: ["go", "payments"],
          createdAt: "2026-01-01T00:00:00Z",
          updatedAt: "2026-04-20T00:00:00Z",
        }),
      ),
    );

    const ui = await ServiceOverviewPage({ params: Promise.resolve({ id: "svc-1" }) });
    render(ui as React.ReactElement);

    expect(screen.getByText("Cart and order placement")).toBeInTheDocument();
    expect(screen.getByText("production")).toBeInTheDocument();
    expect(screen.getByText("t-payments")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /github.com\/foo\/checkout/ })).toBeInTheDocument();
    expect(screen.getByText("go")).toBeInTheDocument();
    expect(screen.getByText("payments")).toBeInTheDocument();
  });

  it("Overview RSC throws notFound on 404", async () => {
    server.use(
      http.get(
        "http://test-gw.local/api/v1/services/missing",
        () => new HttpResponse(null, { status: 404 }),
      ),
    );
    await expect(
      ServiceOverviewPage({ params: Promise.resolve({ id: "missing" }) }),
    ).rejects.toThrow("NOT_FOUND");
  });

  it("ServiceTabs highlights active tab from pathname", () => {
    render(<ServiceTabs id="svc-1" />);
    // Overview is active by default (mock pathname /services/svc-1)
    const overviewBtn = screen.getByRole("tab", { name: "Overview" });
    expect(overviewBtn).toHaveAttribute("data-state", "active");
  });
});
