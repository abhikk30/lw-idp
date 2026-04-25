import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  clustersFixture,
  meFixture,
  servicesFixture,
  teamsFixture,
} from "../../src/msw/fixtures/index.js";
import { createMswServer } from "../../src/msw/server.js";

const server = createMswServer();
beforeAll(() => server.listen({ onUnhandledRequest: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe("MSW gateway handlers", () => {
  it("GET /api/v1/me returns 401 when cookie missing", async () => {
    const res = await fetch("http://api.test.local/api/v1/me");
    expect(res.status).toBe(401);
  });

  it("GET /api/v1/me returns Me when cookie present", async () => {
    const res = await fetch("http://api.test.local/api/v1/me", {
      headers: { cookie: "lw-sid=sess_abc" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as typeof meFixture;
    expect(body.user.email).toBe(meFixture.user.email);
  });

  it("GET /api/v1/services returns the full list", async () => {
    const res = await fetch("http://api.test.local/api/v1/services");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: typeof servicesFixture };
    expect(body.items).toHaveLength(servicesFixture.length);
  });

  it("GET /api/v1/services?q=check filters by slug", async () => {
    const res = await fetch("http://api.test.local/api/v1/services?q=check");
    const body = (await res.json()) as { items: typeof servicesFixture };
    const slugs = body.items.map((s) => s.slug);
    expect(slugs).toContain("checkout");
    expect(slugs).toContain("fraud-check");
    expect(slugs).not.toContain("billing");
  });

  it("POST /api/v1/services creates and returns 201", async () => {
    const res = await fetch("http://api.test.local/api/v1/services", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        slug: "new-svc",
        name: "new-svc",
        type: "service",
        lifecycle: "experimental",
        ownerTeamId: "team-platform-admins",
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; slug: string };
    expect(body.slug).toBe("new-svc");
    expect(body.id).toMatch(/^svc-new-/);
  });

  it("GET /api/v1/clusters list", async () => {
    const res = await fetch("http://api.test.local/api/v1/clusters");
    const body = (await res.json()) as { items: typeof clustersFixture };
    expect(body.items).toHaveLength(clustersFixture.length);
  });

  it("GET /api/v1/teams list", async () => {
    const res = await fetch("http://api.test.local/api/v1/teams");
    const body = (await res.json()) as { teams: typeof teamsFixture };
    expect(body.teams).toHaveLength(teamsFixture.length);
  });

  it("GET /mock/services/checkout/deployments filters by slug", async () => {
    const res = await fetch("http://api.test.local/mock/services/checkout/deployments");
    const body = (await res.json()) as { items: { serviceSlug: string }[] };
    expect(body.items.every((d) => d.serviceSlug === "checkout")).toBe(true);
    expect(body.items.length).toBeGreaterThan(0);
  });
});
