import { http, HttpResponse } from "msw";
import { setupServer } from "msw/node";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// Stub next/headers BEFORE importing server.ts (server.ts imports it eagerly).
vi.mock("next/headers", () => ({
  headers: async () => new Map([["cookie", "lw-sid=sess_test"]]) as unknown as Headers,
}));

vi.stubEnv("GATEWAY_INTERNAL_URL", "http://test-gw.local/api/v1");

const server = setupServer(
  http.get("http://test-gw.local/api/v1/me", ({ request }) => {
    const cookie = request.headers.get("cookie");
    if (cookie !== "lw-sid=sess_test") {
      return new HttpResponse(null, { status: 401 });
    }
    return HttpResponse.json({
      user: {
        id: "u-1",
        subject: "gh|alice",
        email: "alice@test",
        displayName: "Alice",
      },
      teams: [{ id: "t-1", slug: "platform-admins", name: "Platform Admins" }],
    });
  }),
  http.get("http://test-gw.local/api/v1/services", () => HttpResponse.json({ items: [] })),
);

beforeAll(() => server.listen());
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("createServerClient", () => {
  it("forwards inbound cookie to upstream gateway", async () => {
    const { createServerClient } = await import("../../src/lib/api/server.js");
    const client = await createServerClient();
    const { data } = await client.GET("/services", { params: { query: {} } });
    expect(data?.items).toEqual([]);
  });
});

describe("getServerSession", () => {
  it("returns Me on 200", async () => {
    const { getServerSession } = await import("../../src/lib/auth/server.js");
    const me = await getServerSession();
    expect(me?.user.email).toBe("alice@test");
    expect(me?.teams).toHaveLength(1);
  });

  it("returns undefined on 401", async () => {
    server.use(
      http.get("http://test-gw.local/api/v1/me", () => new HttpResponse(null, { status: 401 })),
    );
    // Bypass any module cache from prior tests in this run so the new
    // 401 handler is exercised against a freshly resolved module.
    vi.resetModules();
    const mod = await import("../../src/lib/auth/server.js");
    const me = await mod.getServerSession();
    expect(me).toBeUndefined();
  });
});
