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

import ApiTokensPage from "../../src/app/(app)/settings/api-tokens/page.js";
import ProfilePage from "../../src/app/(app)/settings/profile/page.js";

const server = setupServer();
beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("Settings pages", () => {
  it("Profile shows user + teams", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/me", () =>
        HttpResponse.json({
          user: { id: "u-1", subject: "gh|alice", email: "alice@test", displayName: "Alice" },
          teams: [{ id: "t-1", slug: "platform-admins", name: "Platform Admins" }],
        }),
      ),
    );
    const ui = await ProfilePage();
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { level: 1, name: "Profile" })).toBeInTheDocument();
    expect(screen.getByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@test")).toBeInTheDocument();
    expect(screen.getByText("Platform Admins")).toBeInTheDocument();
  });

  it("ApiTokens page is a stub with disabled button", () => {
    const ui = ApiTokensPage();
    render(ui as React.ReactElement);
    expect(screen.getByRole("heading", { level: 1, name: /api tokens/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /coming p3/i })).toBeDisabled();
  });
});
