import { http, type HttpHandler, HttpResponse } from "msw";
import { clustersFixture } from "./fixtures/clusters.js";
import { deploymentsFixture } from "./fixtures/deployments.js";
import { meFixture } from "./fixtures/me.js";
import { pipelinesFixture } from "./fixtures/pipelines.js";
import { servicesFixture } from "./fixtures/services.js";
import { teamsFixture } from "./fixtures/teams.js";

const BASE = "*/api/v1";

export const handlers: HttpHandler[] = [
  // /me — returns 401 when no cookie present (so unauth flows can be tested too).
  http.get(`${BASE}/me`, ({ request }) => {
    const cookie = request.headers.get("cookie") ?? "";
    if (!cookie.includes("lw-sid=")) {
      return new HttpResponse(null, { status: 401 });
    }
    return HttpResponse.json(meFixture);
  }),

  // /services list (filter + search; minimal — full filtering is integration concern)
  http.get(`${BASE}/services`, ({ request }) => {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.toLowerCase() ?? "";
    const items = q
      ? servicesFixture.filter((s) => s.slug.includes(q) || s.name.toLowerCase().includes(q))
      : servicesFixture;
    return HttpResponse.json({ items });
  }),

  // /services/{id}
  http.get(`${BASE}/services/:id`, ({ params }) => {
    const item = servicesFixture.find((s) => s.id === params.id);
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(item);
  }),

  // POST /services — return a synthesized created item.
  http.post(`${BASE}/services`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      id: `svc-new-${Math.random().toString(36).slice(2, 8)}`,
      slug: String(body.slug ?? "new"),
      name: String(body.name ?? "new"),
      description: (body.description as string | undefined) ?? "",
      type:
        (body.type as "service" | "library" | "website" | "ml" | "job" | undefined) ?? "service",
      lifecycle:
        (body.lifecycle as "experimental" | "production" | "deprecated" | undefined) ??
        "experimental",
      ownerTeamId: String(body.ownerTeamId ?? "team-platform-admins"),
      repoUrl: (body.repoUrl as string | undefined) ?? "",
      tags: (body.tags as string[] | undefined) ?? [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  // PATCH /services/{id}
  http.patch(`${BASE}/services/:id`, async ({ params, request }) => {
    const item = servicesFixture.find((s) => s.id === params.id);
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    const body = (await request.json()) as Record<string, unknown>;
    return HttpResponse.json({ ...item, ...body, updatedAt: new Date().toISOString() });
  }),

  // DELETE /services/{id}
  http.delete(`${BASE}/services/:id`, ({ params }) => {
    const item = servicesFixture.find((s) => s.id === params.id);
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    return new HttpResponse(null, { status: 204 });
  }),

  // /clusters list
  http.get(`${BASE}/clusters`, () => HttpResponse.json({ items: clustersFixture })),
  http.get(`${BASE}/clusters/:id`, ({ params }) => {
    const item = clustersFixture.find((c) => c.id === params.id);
    if (!item) {
      return new HttpResponse(null, { status: 404 });
    }
    return HttpResponse.json(item);
  }),
  http.post(`${BASE}/clusters`, async ({ request }) => {
    const body = (await request.json()) as Record<string, unknown>;
    const created = {
      id: `cl-new-${Math.random().toString(36).slice(2, 8)}`,
      slug: String(body.slug ?? "new"),
      name: String(body.name ?? "new"),
      environment: (body.environment as "dev" | "stage" | "prod" | undefined) ?? "dev",
      region: String(body.region ?? "us-east-1"),
      provider:
        (body.provider as
          | "docker-desktop"
          | "eks"
          | "gke"
          | "aks"
          | "kind"
          | "other"
          | undefined) ?? "kind",
      apiEndpoint: String(body.apiEndpoint ?? ""),
      createdAt: new Date().toISOString(),
    };
    return HttpResponse.json(created, { status: 201 });
  }),

  // /teams — schema uses `teams`, not `items`.
  http.get(`${BASE}/teams`, () => HttpResponse.json({ teams: teamsFixture })),

  // Mock-adapter URLs for deployments + pipelines
  // (web app picks these up via NEXT_PUBLIC_INTEG_*)
  http.get("*/mock/services/:slug/deployments", ({ params }) => {
    const items = deploymentsFixture.filter((d) => d.serviceSlug === params.slug);
    return HttpResponse.json({ items });
  }),
  http.get("*/mock/services/:slug/pipelines", ({ params }) => {
    const items = pipelinesFixture.filter((p) => p.serviceSlug === params.slug);
    return HttpResponse.json({ items });
  }),
];
