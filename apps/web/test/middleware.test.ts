import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { middleware } from "../src/middleware.js";

function makeReq(url: string, cookies: Record<string, string> = {}): NextRequest {
  const req = new NextRequest(new URL(url));
  for (const [name, value] of Object.entries(cookies)) {
    req.cookies.set(name, value);
  }
  return req;
}

describe("middleware", () => {
  it("redirects unauth /services to /auth/login?redirect=/services", () => {
    const req = makeReq("http://localhost:3001/services");
    const res = middleware(req);
    expect(res.status).toBe(307); // NextResponse.redirect default
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("/auth/login");
    expect(location).toContain("redirect=%2Fservices");
  });

  it("redirects unauth /clusters/[id] preserving query string", () => {
    const req = makeReq("http://localhost:3001/clusters/abc?tab=overview");
    const res = middleware(req);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain("redirect=%2Fclusters%2Fabc%3Ftab%3Doverview");
  });

  it("does NOT redirect when /auth/login (would cause a loop)", () => {
    const req = makeReq("http://localhost:3001/auth/login");
    const res = middleware(req);
    // NextResponse.next() returns a response with no location header
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect when /api/healthz (probe path)", () => {
    const req = makeReq("http://localhost:3001/api/healthz");
    const res = middleware(req);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT redirect when /api/readyz", () => {
    const req = makeReq("http://localhost:3001/api/readyz");
    const res = middleware(req);
    expect(res.headers.get("location")).toBeNull();
  });

  it("passes through when lw-sid cookie present", () => {
    const req = makeReq("http://localhost:3001/services", { "lw-sid": "sess_abc" });
    const res = middleware(req);
    expect(res.headers.get("location")).toBeNull();
  });

  it("does NOT add ?redirect=/ for the root path (avoid clutter)", () => {
    const req = makeReq("http://localhost:3001/");
    const res = middleware(req);
    expect(res.status).toBe(307);
    const location = res.headers.get("location") ?? "";
    expect(location).not.toContain("redirect=");
  });
});
