import { render, screen } from "@testing-library/react";
import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
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
  usePathname: () => "/teams",
}));

import TeamDetailPage from "../../src/app/(app)/teams/[slug]/page.js";
import TeamsPage from "../../src/app/(app)/teams/page.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Teams pages", () => {
  it("TeamsPage renders rows", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/teams", () =>
        HttpResponse.json({
          teams: [
            { id: "t-1", slug: "platform-admins", name: "Platform Admins" },
            { id: "t-2", slug: "payments", name: "Payments" },
          ],
        }),
      ),
    );
    const ui = await TeamsPage();
    render(ui as React.ReactElement);
    expect(screen.getByText("platform-admins")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
  });

  it("TeamDetailPage finds the team by slug", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/teams", () =>
        HttpResponse.json({
          teams: [{ id: "t-1", slug: "platform-admins", name: "Platform Admins" }],
        }),
      ),
    );
    const ui = await TeamDetailPage({ params: Promise.resolve({ slug: "platform-admins" }) });
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { level: 1, name: "Platform Admins" })).toBeInTheDocument();
  });

  it("TeamDetailPage notFound when slug missing", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/teams", () => HttpResponse.json({ teams: [] })),
    );
    await expect(TeamDetailPage({ params: Promise.resolve({ slug: "nope" }) })).rejects.toThrow(
      "NOT_FOUND",
    );
  });
});
